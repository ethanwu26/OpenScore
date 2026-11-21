// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILensToken {
    function balanceOf(address who) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface ILensCard {
    function agentCount() external view returns (uint256);
    function agents(uint256 i) external view returns (address);
    function ownerOf(address agent) external view returns (address);
    function nameOf(address agent) external view returns (string memory);
}

interface ILensPool {
    function quote(address user, uint128 collateral) external view returns (uint16 score, uint256 limit, uint96 fee);
    function loansOf(address borrower) external view returns (uint256[] memory);
    function loans(uint256 id)
        external
        view
        returns (address borrower, uint128 principal, uint128 collateral, uint64 due, bool closed);
    function liquidity() external view returns (uint256);
    function outstanding() external view returns (uint256);
    function earned() external view returns (uint256);
    function loanCount() external view returns (uint256);
    function modelId() external view returns (uint32);
    function dualEnabled() external view returns (bool);
}

interface ILensBook {
    function features(address user, uint128 collateral) external view returns (int256[10] memory);
    function periodsOf(address user) external view returns (uint32);
    function defaultsOf(address user) external view returns (uint32);
    function lastDefaultOf(address user) external view returns (uint64);
    function firstSeenOf(address user) external view returns (uint64);
}

interface ILensModel {
    function score(int256[10] calldata f) external view returns (uint16);
    function explain(int256[10] calldata f) external view returns (uint16[5] memory);
}

interface ILensShop {
    function priceFor(address agent) external view returns (uint16 score, uint256 price);
    function basePrice() external view returns (uint256);
    function purchases() external view returns (uint256);
    function merchant() external view returns (address);
}

/// @title  OpenScoreLens — read-only views for the front end.
/// @notice One eth_call returns everything a page needs, so the demo does not depend on
///         log queries or on dozens of round trips to a public RPC. Holds no state.
contract OpenScoreLens {
    ILensToken public immutable usd;
    ILensCard public immutable card;
    ILensPool public immutable pool;
    ILensBook public immutable book;
    ILensShop public immutable shop;
    ILensModel public immutable scoreCard;
    ILensModel public immutable neural;
    uint128 public immutable refCollateral;

    struct AgentView {
        address agent;
        address owner;
        string name;
        bool quoteOk; // false when the pool's model is frozen
        uint16 score; // what the pool uses
        uint256 limit;
        uint16 neuralScore; // second opinion, not used for the limit unless dual mode is on
        uint16[5] parts; // payment history, amounts owed, history length, new credit, collateral
        int256[10] features;
        uint32 periods;
        uint32 defaults;
        uint64 lastDefault;
        uint64 firstSeen;
        uint256 balance; // USD
        uint256 gasBalance; // native MON
        uint256 poolAllowance;
        bool priceOk;
        uint256 price; // what the shop would charge right now
        bool hasOpenLoan;
        uint256 openLoanId;
        uint128 debt;
        uint128 locked; // collateral locked in the open loan
        uint64 due;
        uint256 loanCount;
    }

    struct PoolView {
        uint256 liquidity;
        uint256 outstanding;
        uint256 earned;
        uint256 loanCount;
        uint32 modelId;
        bool dual;
        uint256 basePrice;
        uint256 purchases;
        address merchant;
        uint256 merchantBalance;
        uint256 agentCount;
        uint256 blockTime;
        uint256 blockNumber;
    }

    constructor(
        address _usd,
        address _card,
        address _pool,
        address _book,
        address _shop,
        address _scoreCard,
        address _neural,
        uint128 _refCollateral
    ) {
        usd = ILensToken(_usd);
        card = ILensCard(_card);
        pool = ILensPool(_pool);
        book = ILensBook(_book);
        shop = ILensShop(_shop);
        scoreCard = ILensModel(_scoreCard);
        neural = ILensModel(_neural);
        refCollateral = _refCollateral;
    }

    function agentView(address a) public view returns (AgentView memory v) {
        v.agent = a;
        v.owner = card.ownerOf(a);
        v.name = card.nameOf(a);
        v.features = book.features(a, refCollateral);
        v.parts = scoreCard.explain(v.features);
        try neural.score(v.features) returns (uint16 s) {
            v.neuralScore = s;
        } catch {}
        try pool.quote(a, refCollateral) returns (uint16 s, uint256 l, uint96) {
            v.quoteOk = true;
            v.score = s;
            v.limit = l;
        } catch {}
        try shop.priceFor(a) returns (uint16, uint256 p) {
            v.priceOk = true;
            v.price = p;
        } catch {}
        v.periods = book.periodsOf(a);
        v.defaults = book.defaultsOf(a);
        v.lastDefault = book.lastDefaultOf(a);
        v.firstSeen = book.firstSeenOf(a);
        v.balance = usd.balanceOf(a);
        v.gasBalance = a.balance;
        v.poolAllowance = usd.allowance(a, address(pool));

        uint256[] memory ids = pool.loansOf(a);
        v.loanCount = ids.length;
        for (uint256 i = ids.length; i > 0; --i) {
            (, uint128 principal, uint128 collateral, uint64 due, bool closed) = pool.loans(ids[i - 1]);
            if (!closed && principal > 0) {
                v.hasOpenLoan = true;
                v.openLoanId = ids[i - 1];
                v.debt = principal;
                v.locked = collateral;
                v.due = due;
                break;
            }
        }
    }

    function poolView() public view returns (PoolView memory p) {
        p.liquidity = pool.liquidity();
        p.outstanding = pool.outstanding();
        p.earned = pool.earned();
        p.loanCount = pool.loanCount();
        p.modelId = pool.modelId();
        p.dual = pool.dualEnabled();
        p.basePrice = shop.basePrice();
        p.purchases = shop.purchases();
        p.merchant = shop.merchant();
        p.merchantBalance = usd.balanceOf(p.merchant);
        p.agentCount = card.agentCount();
        p.blockTime = block.timestamp;
        p.blockNumber = block.number;
    }

    /// @notice Everything the card page shows, newest card first, at most `max` cards.
    function board(uint256 max) external view returns (AgentView[] memory list, PoolView memory p) {
        p = poolView();
        uint256 n = p.agentCount;
        uint256 m = n < max ? n : max;
        list = new AgentView[](m);
        for (uint256 i; i < m; ++i) {
            list[i] = agentView(card.agents(n - 1 - i));
        }
    }

    /// @notice The calculator page: any ten feature values, both models, free.
    function trial(int256[10] calldata f)
        external
        view
        returns (uint16 cardScore, uint16[5] memory parts, uint16 neuralScore)
    {
        cardScore = scoreCard.score(f);
        parts = scoreCard.explain(f);
        try neural.score(f) returns (uint16 s) {
            neuralScore = s;
        } catch {}
    }
}
