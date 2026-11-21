// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title  Bench — the same monthly settlement written two ways.
/// @notice payDense keeps 4 x 64-bit balances per storage slot with accounts numbered
///         consecutively, so 128 slots (512 accounts) share one Monad storage page.
///         payScattered is the usual layout: one balance per slot, every slot on a different
///         page — what a Solidity mapping does.
/// @dev    Monad receipts report gasUsed == gasLimit, so each call measures its own
///         execution gas with gasleft() and stores it. That number is what the page reads.
contract Bench {
    struct Run {
        uint64 n; // accounts updated
        uint64 gasUsed; // execution gas measured inside the call
        uint64 at; // block timestamp
        uint64 count; // how many times this path has run
    }

    Run public lastDense;
    Run public lastScattered;

    uint256 internal constant DENSE_BASE = 0x1000000;

    event Settled(bool dense, uint256 n, uint256 gasUsed);

    /// same amount to n consecutive accounts
    function payDense(uint256 n, uint256 amt) external {
        uint256 g = gasleft();
        assembly {
            let m := mul(amt, 0x0000000000000001000000000000000100000000000000010000000000000001)
            let slots := div(add(n, 3), 4)
            for { let i := 0 } lt(i, slots) { i := add(i, 1) } {
                let s := add(DENSE_BASE, i)
                sstore(s, add(sload(s), m))
            }
        }
        uint256 used = g - gasleft();
        lastDense = Run(uint64(n), uint64(used), uint64(block.timestamp), lastDense.count + 1);
        emit Settled(true, n, used);
    }

    /// a different amount per account: 8 bytes each in calldata
    function payDenseVar(bytes calldata amts) external {
        uint256 g = gasleft();
        assembly {
            let slots := div(add(amts.length, 31), 32)
            for { let i := 0 } lt(i, slots) { i := add(i, 1) } {
                let s := add(DENSE_BASE, i)
                sstore(s, add(sload(s), calldataload(add(amts.offset, mul(i, 32)))))
            }
        }
        uint256 used = g - gasleft();
        lastDense = Run(uint64(amts.length / 8), uint64(used), uint64(block.timestamp), lastDense.count + 1);
        emit Settled(true, amts.length / 8, used);
    }

    /// the usual layout: one balance per slot, every slot on a different storage page
    function payScattered(uint256 n, uint256 amt) external {
        uint256 g = gasleft();
        assembly {
            for { let i := 1 } iszero(gt(i, n)) { i := add(i, 1) } {
                let s := shl(128, i)
                sstore(s, add(sload(s), amt))
            }
        }
        uint256 used = g - gasleft();
        lastScattered = Run(uint64(n), uint64(used), uint64(block.timestamp), lastScattered.count + 1);
        emit Settled(false, n, used);
    }

    /// balance of dense account i (0-based)
    function denseAt(uint256 i) external view returns (uint64 v) {
        assembly {
            v := and(shr(mul(64, mod(i, 4)), sload(add(DENSE_BASE, div(i, 4)))), 0xffffffffffffffff)
        }
    }

    /// balance of scattered account i (1-based, as in payScattered)
    function scatteredAt(uint256 i) external view returns (uint256 v) {
        assembly {
            v := sload(shl(128, i))
        }
    }
}
