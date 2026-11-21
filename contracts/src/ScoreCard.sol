// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  ScoreCard — a monotone points scorecard with the same interface as RiskModel.
/// @notice Five factors weighted by the publicly documented FICO category weights:
///         payment history 350, amounts owed 300, length of history 150, new credit 100,
///         and 100 mapped to collateral size ("credit mix" has no on-chain analogue).
///         Points inside a factor are fitted on public repayment data (24,000 rows) and forced
///         to be monotone, so no input can raise the score by getting worse.
///         AUC on that data: 0.7234. score(int256[10]) -> 0..1000.
contract ScoreCard {
    uint256 public constant VERSION = 2;
    uint256 public constant FEATURES = 10;

    function _f2(int256 x) private pure returns (uint256) { // maxDelay
        if (x <= 0) return 140;
        if (x <= 2) return 62;
        return 0;
    }
    function _f3(int256 x) private pure returns (uint256) { // delayCount
        if (x <= 0) return 161;
        if (x <= 1) return 102;
        if (x <= 2) return 70;
        return 0;
    }
    function _f6(int256 x) private pure returns (uint256) { // zeroPayCount
        if (x <= 0) return 48;
        if (x <= 1) return 12;
        if (x <= 2) return 5;
        if (x <= 4) return 5;
        return 0;
    }
    function _f5(int256 x) private pure returns (uint256) { // utilization
        if (x <= 3) return 58;
        if (x <= 21) return 58;
        if (x <= 97) return 58;
        if (x <= 308) return 58;
        if (x <= 576) return 31;
        if (x <= 828) return 12;
        if (x <= 967) return 12;
        return 0;
    }
    function _f9(int256 x) private pure returns (uint256) { // maxUtil
        if (x <= 17) return 74;
        if (x <= 68) return 74;
        if (x <= 193) return 74;
        if (x <= 426) return 74;
        if (x <= 682) return 50;
        if (x <= 922) return 36;
        if (x <= 1003) return 36;
        return 0;
    }
    function _f4(int256 x) private pure returns (uint256) { // repayRatio
        if (x <= 36) return 0;
        if (x <= 43) return 35;
        if (x <= 58) return 35;
        if (x <= 107) return 35;
        if (x <= 303) return 65;
        if (x <= 719) return 72;
        if (x <= 1000) return 72;
        return 72;
    }
    function _f7(int256 x) private pure returns (uint256) { // lastPayRatio
        if (x <= 8) return 0;
        if (x <= 39) return 87;
        if (x <= 49) return 87;
        if (x <= 74) return 87;
        if (x <= 157) return 87;
        if (x <= 654) return 95;
        if (x <= 1000) return 97;
        return 97;
    }
    function _f8(int256 x) private pure returns (uint256) { // billTrend
        if (x <= -87) return 100;
        if (x <= -28) return 100;
        if (x <= 0) return 100;
        if (x <= 7) return 100;
        if (x <= 49) return 100;
        if (x <= 181) return 100;
        if (x <= 446) return 100;
        return 0;
    }
    function _f1(int256 x) private pure returns (uint256) { // collateral
        if (x <= 300) return 0;
        if (x <= 500) return 38;
        if (x <= 900) return 43;
        if (x <= 1400) return 56;
        if (x <= 1900) return 78;
        if (x <= 2400) return 82;
        if (x <= 3400) return 94;
        return 100;
    }

    function _clamp(int256 x, int256 lo, int256 hi) private pure returns (uint256) {
        if (x < lo) return uint256(lo);
        if (x > hi) return uint256(hi);
        return uint256(x);
    }

    /// @return parts [paymentHistory, amountsOwed, historyLength, newCredit, collateral]
    function explain(int256[10] calldata f) public pure returns (uint16[5] memory parts) {
        // A thin file is not a clean file: no repayment on record, no payment-history points.
        uint256 p = f[4] > 0 ? _f2(f[2]) + _f3(f[3]) + _f6(f[6]) : 0;
        parts[0] = uint16(p);
        parts[1] = uint16(_f5(f[5]) + _f9(f[9]) + _f4(f[4]) + _f7(f[7]));
        parts[2] = uint16((150 * _clamp(f[0], 0, 365)) / 365);
        parts[3] = uint16(_f8(f[8]));
        parts[4] = uint16(_f1(f[1]));
    }

    function score(int256[10] calldata f) public pure returns (uint16) {
        uint16[5] memory p = explain(f);
        return p[0] + p[1] + p[2] + p[3] + p[4];
    }

    function scoreBatch(int256[10][] calldata fs) external pure returns (uint16[] memory out) {
        out = new uint16[](fs.length);
        for (uint256 i; i < fs.length; ++i) out[i] = score(fs[i]);
    }
}
