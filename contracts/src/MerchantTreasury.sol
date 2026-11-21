// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title  MerchantTreasury — where a merchant's card receipts land.
/// @notice Optional payee for CreditShop. The pool pays this contract during swipe(),
///         the merchant withdraws whenever they like, and nothing else can move funds.
///         A plain EOA merchant can skip this contract and be paid directly.
contract MerchantTreasury {
    IERC20Like public immutable usd;
    address public immutable merchant;

    uint256 public totalWithdrawn;

    event Withdrawn(address indexed to, uint256 amount, uint256 total);

    error NotMerchant();
    error BadAmount();
    error TransferFailed();

    constructor(address _usd, address _merchant) {
        usd = IERC20Like(_usd);
        merchant = _merchant;
    }

    /// @notice What is waiting to be withdrawn.
    function balance() external view returns (uint256) {
        return usd.balanceOf(address(this));
    }

    function withdraw(address to, uint256 amount) external {
        if (msg.sender != merchant) revert NotMerchant();
        if (amount == 0 || to == address(0)) revert BadAmount();
        totalWithdrawn += amount;
        if (!usd.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount, totalWithdrawn);
    }

    function withdrawAll(address to) external returns (uint256 amount) {
        if (msg.sender != merchant) revert NotMerchant();
        if (to == address(0)) revert BadAmount();
        amount = usd.balanceOf(address(this));
        if (amount == 0) revert BadAmount();
        totalWithdrawn += amount;
        if (!usd.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount, totalWithdrawn);
    }
}
