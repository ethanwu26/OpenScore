// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Pay {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPoolQuote {
    function quote(address user, uint128 collateral) external view returns (uint16 score, uint256 limit, uint96 fee);
}

/// @title  CreditShop — a paid service that reads the buyer's score in the same transaction.
/// @notice The merchant is paid in full at once; the price depends on the agent's score.
///         This is the "any contract can call the score" half of the loop.
contract CreditShop {
    IERC20Pay public immutable usd;
    IPoolQuote public immutable pool;
    address public immutable merchant;
    uint128 public immutable refCollateral;   // collateral used when asking for the score
    uint256 public immutable basePrice;

    uint16 public constant MIN_SCORE = 250;       // below this the service refuses the agent
    uint16 public constant DISCOUNT_SCORE = 600;  // at or above this the agent pays 80%

    event Purchased(address indexed agent, uint16 score, uint256 price, uint256 purchases);

    error ScoreTooLow(uint16 score);
    error OnlyPool();

    uint256 public purchases;

    constructor(address _usd, address _pool, address _merchant, uint128 _refCollateral, uint256 _basePrice) {
        usd = IERC20Pay(_usd);
        pool = IPoolQuote(_pool);
        merchant = _merchant;
        refCollateral = _refCollateral;
        basePrice = _basePrice;
    }

    function priceFor(address agent) public view returns (uint16 score, uint256 price) {
        (score,,) = pool.quote(agent, refCollateral);
        price = score >= DISCOUNT_SCORE ? (basePrice * 80) / 100 : basePrice;
    }

    /// @notice Card payment. Only the pool calls this, from inside swipe(): the shop names the
    ///         price for this agent and the pool pays the merchant in the same transaction.
    function checkout(address agent) external returns (uint256 price, address payee) {
        if (msg.sender != address(pool)) revert OnlyPool();
        uint16 score;
        (score, price) = priceFor(agent);
        if (score < MIN_SCORE) revert ScoreTooLow(score);
        purchases += 1;
        emit Purchased(agent, score, price, purchases);
        return (price, merchant);
    }

    /// @notice Pay with the agent's own balance instead of the card.
    function buy() external returns (uint256 price) {
        uint16 score;
        (score, price) = priceFor(msg.sender);
        if (score < MIN_SCORE) revert ScoreTooLow(score);
        require(usd.transferFrom(msg.sender, merchant, price), "PAY");
        purchases += 1;
        emit Purchased(msg.sender, score, price, purchases);
    }
}
