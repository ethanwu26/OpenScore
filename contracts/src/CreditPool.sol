// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IBook {
    function firstSeenOf(address user) external view returns (uint64);
    function touch(address user) external;
    function noteDefault(address user) external;
    function defaultsOf(address user) external view returns (uint32);
    function lastDefaultOf(address user) external view returns (uint64);
    function setLimit(address user, uint128 limit) external;
    function record(address user, uint128 owed, uint128 paid, uint8 delay) external;
    function periodsOf(address user) external view returns (uint32);
    function features(address user, uint128 collateral) external view returns (int256[10] memory);
}

interface IScore {
    function score(int256[10] calldata f) external view returns (uint16);
}

interface IShop {
    /// Called by the pool during swipe(); returns what the agent owes and who gets paid.
    function checkout(address agent) external returns (uint256 price, address merchant);
}

interface IRegistry {
    function isUsable(uint32 id) external view returns (bool);
    function modelOf(uint32 id) external view returns (address);
    function feeOf(uint32 id) external view returns (uint96);
    function authorOf(uint32 id) external view returns (address);
}

/// @title  CreditPool — the one place where a score moves money.
/// @notice borrow() reads the borrower's on-chain behaviour, asks the subscribed model
///         for a score, turns the score into a limit and pays out — all in one
///         transaction. There is no server in this path and no oracle input.
/// @dev    A period is a single borrow/repay cycle. The pool charges no interest; lenders
///         earn the interchange cut that merchants give up on every swipe().
contract CreditPool {
    struct Loan {
        address borrower;
        uint128 principal; // outstanding
        uint128 collateral;
        uint64 due;
        bool closed;
    }

    IERC20Like public immutable usd;
    IBook public immutable book;
    IRegistry public registry;
    uint32 public modelId;

    mapping(uint256 => Loan) public loans;
    uint256 public loanCount;
    uint256 public liquidity;
    uint256 public constant COOLDOWN = 7 days;
    uint256 public constant BPS = 10_000;

    /// Leverage ceiling in bps of the score-scaled line. 10_000 = 1.0x, 15_000 = 1.5x.
    /// Anything above 1.0x creates unsecured exposure, so it needs evidence and a bond.
    uint256 public leverageBps = 10_000;
    uint32 public constant MIN_PERIODS_FOR_LEVERAGE = 3;
    uint64 public constant MIN_AGE_FOR_LEVERAGE = 7 days;

    bool public dualEnabled;
    uint32 public modelId2;
    uint16 public consensusTolerance = 40;

    address public owner;

    /// Merchant discount on swipe(), in bps of the price. It stays in the pool as lender income.
    uint256 public constant INTERCHANGE_BPS = 100;
    uint256 public earned; // interchange collected so far
    uint256 public outstanding; // principal currently lent out
    mapping(address => uint256) public depositOf; // lender => principal supplied
    mapping(address => uint256[]) internal _loansOf;

    event Swiped(
        uint256 indexed id, address indexed agent, address indexed shop, address merchant, uint256 price, uint256 interchange
    );
    event CollateralReturned(uint256 indexed id, address indexed borrower, uint128 collateral);

    event Scored(address indexed user, uint16 score, uint256 limit);
    event Borrowed(uint256 indexed id, address indexed borrower, uint128 amount, uint128 collateral, uint16 score, uint96 fee);
    event Repaid(uint256 indexed id, uint128 amount, uint128 outstanding);
    event Liquidated(uint256 indexed id, uint128 collateral);
    event LiquidityChanged(address indexed who, int256 delta, uint256 total);

    error NotUsableModel();
    error NoHistory();
    error OverLimit();
    error NoLiquidity();
    error NotBorrower();
    error NotDue();
    error InCooldown();
    error ModelsDisagree(uint16 a, uint16 b);
    error BadAmount();

    constructor(address _usd, address _book, address _registry, uint32 _modelId) {
        usd = IERC20Like(_usd);
        book = IBook(_book);
        registry = IRegistry(_registry);
        modelId = _modelId;
        owner = msg.sender;
    }

    /// @notice Credit line = collateral * score / 1000. A perfect score unlocks the full
    ///         collateral, a zero score unlocks nothing. One number, no black box.
    function limitFor(uint16 score, uint256 collateral) public pure returns (uint256) {
        return (collateral * uint256(score)) / 1000;
    }

    /// @notice Games the ring can hide, a liquidation cannot: one default halves the line
    ///         for good, and a fresh borrow is blocked for a cooldown period.
    function limitWithHistory(address user, uint16 score, uint256 collateral) public view returns (uint256 limit) {
        limit = (limitFor(score, collateral) * leverageBps) / BPS;
        if (limit > collateral) {
            // The part above the collateral is unsecured: it requires a proven record.
            bool proven = book.periodsOf(user) >= MIN_PERIODS_FOR_LEVERAGE
                && book.defaultsOf(user) == 0
                && block.timestamp >= uint256(book.firstSeenOf(user)) + MIN_AGE_FOR_LEVERAGE;
            if (!proven) limit = collateral;
        }
        if (book.defaultsOf(user) > 0) limit /= 2;
    }

    function setLeverage(uint256 bps) external {
        require(msg.sender == owner, "OWNER");
        require(bps >= BPS / 2 && bps <= 20_000, "RANGE");
        leverageBps = bps;
    }

    function setDual(uint32 id2, uint16 tol) external {
        require(msg.sender == owner, "OWNER");
        dualEnabled = true;
        modelId2 = id2;
        consensusTolerance = tol;
    }

    function setSingle() external {
        require(msg.sender == owner, "OWNER");
        dualEnabled = false;
    }

    function quote(address user, uint128 collateral) public view returns (uint16 score, uint256 limit, uint96 fee) {
        (uint16 s1, uint16 s2) = scoresOf(user, collateral);
        score = s1;
        limit = limitWithHistory(user, score, collateral);
        fee = registry.feeOf(modelId);
        if (dualEnabled) {
            require(registry.isUsable(modelId2), "MODEL2");
            fee += registry.feeOf(modelId2);
        }
    }

    /// @notice With two models the pool takes the lower score and refuses to lend when
    ///         they disagree by more than `consensusTolerance` points.
    function scoresOf(address user, uint128 collateral) public view returns (uint16 s1, uint16 s2) {
        int256[10] memory f = book.features(user, collateral);
        s1 = IScore(_model()).score(f);
        if (!dualEnabled) return (s1, 0);
        if (!registry.isUsable(modelId2)) revert NotUsableModel();
        s2 = IScore(registry.modelOf(modelId2)).score(f);
        uint16 hi = s1 > s2 ? s1 : s2;
        uint16 lo = s1 > s2 ? s2 : s1;
        if (hi - lo > consensusTolerance) revert ModelsDisagree(s1, s2);
        s1 = lo;
    }

    function _model() internal view returns (address) {
        if (!registry.isUsable(modelId)) revert NotUsableModel();
        return registry.modelOf(modelId);
    }

    function deposit(uint256 amount) external {
        require(usd.transferFrom(msg.sender, address(this), amount), "TRANSFER");
        liquidity += amount;
        depositOf[msg.sender] += amount;
        emit LiquidityChanged(msg.sender, int256(amount), liquidity);
    }

    /// @notice A lender can take back at most what they supplied, and only what is not lent out.
    function withdraw(uint256 amount) external {
        if (amount > liquidity || amount > depositOf[msg.sender]) revert NoLiquidity();
        depositOf[msg.sender] -= amount;
        liquidity -= amount;
        require(usd.transfer(msg.sender, amount), "TRANSFER");
        emit LiquidityChanged(msg.sender, -int256(amount), liquidity);
    }

    /// @notice A fresh address has no history, so its score is whatever the model says
    ///         about a zeroed profile — the pool simply lends against that limit.
    function borrow(uint128 amount, uint128 collateral, uint32 lockDays) external returns (uint256 id) {
        id = _open(msg.sender, amount, collateral, lockDays, msg.sender, 0);
    }

    /// @notice Card payment in one transaction: the shop names its price for this agent
    ///         (it may read the agent's score to do so), the pool scores the agent, checks
    ///         the limit, pays the merchant and books the debt against the agent.
    ///         The merchant gives up INTERCHANGE_BPS of the price; that cut is lender income.
    function swipe(address shop, uint128 collateral, uint32 lockDays) external returns (uint256 id, uint256 price) {
        address merchant;
        (price, merchant) = IShop(shop).checkout(msg.sender);
        if (price == 0 || price > type(uint128).max || merchant == address(0)) revert BadAmount();
        uint256 cut = (price * INTERCHANGE_BPS) / BPS;
        id = _open(msg.sender, uint128(price), collateral, lockDays, merchant, cut);
        emit Swiped(id, msg.sender, shop, merchant, price, cut);
    }

    function _open(address borrower, uint128 amount, uint128 collateral, uint32 lockDays, address payTo, uint256 cut)
        internal
        returns (uint256 id)
    {
        if (amount == 0 || collateral == 0) revert BadAmount();

        (uint16 score, uint256 limit, uint96 fee) = quote(borrower, collateral);
        if (book.defaultsOf(borrower) > 0 && block.timestamp < book.lastDefaultOf(borrower) + COOLDOWN) {
            revert InCooldown();
        }
        if (amount > limit) revert OverLimit();
        if (amount + fee > liquidity) revert NoLiquidity();

        book.touch(borrower);
        book.setLimit(borrower, collateral);
        require(usd.transferFrom(borrower, address(this), collateral), "COLLATERAL");
        liquidity -= uint256(amount) + fee - cut;
        outstanding += amount;
        earned += cut;
        require(usd.transfer(payTo, amount - cut), "TRANSFER");
        if (fee > 0) {
            uint96 f1 = registry.feeOf(modelId);
            if (f1 > 0) require(usd.transfer(registry.authorOf(modelId), f1), "FEE");
            if (dualEnabled) {
                uint96 f2 = fee - f1;
                if (f2 > 0) require(usd.transfer(registry.authorOf(modelId2), f2), "FEE2");
            }
        }

        id = loanCount++;
        loans[id] = Loan({
            borrower: borrower,
            principal: amount,
            collateral: collateral,
            due: uint64(block.timestamp + uint256(lockDays) * 1 days),
            closed: false
        });
        _loansOf[borrower].push(id);
        emit Scored(borrower, score, limit);
        emit Borrowed(id, borrower, amount, collateral, score, fee);
    }

    function repay(uint256 id, uint128 amount) external {
        Loan storage l = loans[id];
        if (l.borrower != msg.sender) revert NotBorrower();
        if (l.closed || amount == 0 || amount > l.principal) revert BadAmount();

        uint8 delay = block.timestamp > l.due ? 1 : 0;
        l.principal -= amount;
        book.record(msg.sender, amount, amount, delay);
        require(usd.transferFrom(msg.sender, address(this), amount), "TRANSFER");
        liquidity += amount;
        outstanding -= amount;
        emit Repaid(id, amount, l.principal);

        // Debt cleared: the loan is settled and the locked collateral goes back.
        if (l.principal == 0) {
            l.closed = true;
            uint128 col = l.collateral;
            require(usd.transfer(msg.sender, col), "COLLATERAL");
            emit CollateralReturned(id, msg.sender, col);
        }
    }

    function liquidate(uint256 id) external {
        Loan storage l = loans[id];
        if (l.closed) revert BadAmount();
        if (block.timestamp <= l.due || l.principal == 0) revert NotDue();
        l.closed = true;
        uint128 col = l.collateral;
        // The seized collateral replaces the principal that will not come back.
        outstanding -= l.principal;
        liquidity += col;
        book.record(l.borrower, l.principal, 0, 1);
        book.noteDefault(l.borrower);
        emit Liquidated(id, col);
    }

    function loansOf(address borrower) external view returns (uint256[] memory) {
        return _loansOf[borrower];
    }

    function info() external view returns (uint32 model, uint256 liquidityNow, uint256 loansMade) {
        return (modelId, liquidity, loanCount);
    }
}
