// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBase {
    function score(int256[10] calldata f) external view returns (uint16);
}

/// @title  ShiftModel — a second opinion that is honestly different.
/// @notice Wraps another model and shifts every score by a fixed delta. Used as the
///         "second model" in a consensus pool: it audits correctly against its own
///         reference scores, but disagrees with the first model by exactly delta.
contract ShiftModel {
    IBase public immutable base;
    int256 public immutable delta;

    constructor(address _base, int256 _delta) {
        base = IBase(_base);
        delta = _delta;
    }

    function score(int256[10] calldata f) external view returns (uint16) {
        int256 s = int256(uint256(base.score(f))) + delta;
        if (s < 0) s = 0;
        else if (s > 1000) s = 1000;
        return uint16(uint256(s));
    }
}
