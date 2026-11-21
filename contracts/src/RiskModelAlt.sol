// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  RiskModelAlt — a swapped-weight decoy from 10 on-chain observable features.
/// @notice Weights are compiled into the contract: a model is an address, it cannot
///         be swapped underneath a pool that subscribed to it.
/// @dev    All arithmetic is bounded by construction: |z| <= 127, |w| <= 127, H = 32.
///         unchecked is safe here and saves ~55% of the gas.
///         Data: UCI Default of Credit Card Clients (30,000 rows, 22.1% default).
///         Layout 10 -> 32 -> 1, int8 weights, int32 biases, inputs normalised in-contract.
contract RiskModelAlt {
    uint256 public constant VERSION = 1;
    uint256 public constant FEATURES = 10;
    uint256 public constant HIDDEN = 32;
    /// Integer scale of the logit: float logit = logit / LOGIT_SCALE.
    int256 public constant LOGIT_SCALE = 110996;

    /// Mean and standard deviation of each feature, scaled by 1e3 to keep integer precision.
    function _mu() internal pure returns (int256[10] memory m) {
        m = [int256(1064565), int256(1674843), int256(682), int256(834), int256(345748), int256(422871), int256(1230), int256(313360), int256(79632), int256(493335)];
    }

    function _sd() internal pure returns (int256[10] memory m) {
        m = [int256(276533), int256(1297455), int256(1074), int256(1554), int256(380924), int256(404617), int256(1719), int256(397160), int256(216664), int256(421348)];
    }

    function _w0() internal pure returns (int256[320] memory m) {
        m = [int256(-41), int256(15), int256(40), int256(-8), int256(16), int256(16), int256(5), int256(41), int256(19), int256(-20), int256(-5), int256(-49), int256(-10), int256(-15), int256(-30), int256(12), int256(-73), int256(-38), int256(14), int256(24), int256(-13), int256(13), int256(-6), int256(-15), int256(-10), int256(-25), int256(-32), int256(10), int256(-3), int256(47), int256(13), int256(6), int256(55), int256(28), int256(18), int256(-2), int256(16), int256(59), int256(71), int256(30), int256(0), int256(41), int256(5), int256(43), int256(-5), int256(11), int256(34), int256(1), int256(63), int256(40), int256(9), int256(1), int256(-3), int256(47), int256(-27), int256(0), int256(-11), int256(50), int256(-2), int256(19), int256(-2), int256(-15), int256(-2), int256(-81), int256(-53), int256(-3), int256(32), int256(7), int256(5), int256(-70), int256(18), int256(-14), int256(-6), int256(0), int256(70), int256(-37), int256(-6), int256(-19), int256(23), int256(-1), int256(8), int256(-16), int256(31), int256(-17), int256(-41), int256(-8), int256(11), int256(-8), int256(-53), int256(25), int256(62), int256(42), int256(-19), int256(2), int256(-27), int256(11), int256(39), int256(-33), int256(-22), int256(-70), int256(7), int256(-5), int256(-5), int256(-39), int256(33), int256(-18), int256(-96), int256(-4), int256(-36), int256(16), int256(-32), int256(-34), int256(-33), int256(-40), int256(12), int256(-19), int256(-26), int256(-15), int256(14), int256(40), int256(72), int256(12), int256(-50), int256(-85), int256(15), int256(-18), int256(-3), int256(33), int256(35), int256(-38), int256(-40), int256(-13), int256(-30), int256(28), int256(-8), int256(-5), int256(3), int256(-1), int256(-20), int256(10), int256(9), int256(-45), int256(-1), int256(8), int256(17), int256(-56), int256(-47), int256(-34), int256(-33), int256(-35), int256(-45), int256(-35), int256(19), int256(-19), int256(-17), int256(-40), int256(-4), int256(15), int256(-57), int256(-24), int256(55), int256(-8), int256(-31), int256(-60), int256(45), int256(-4), int256(16), int256(-71), int256(19), int256(15), int256(4), int256(25), int256(9), int256(10), int256(-9), int256(-61), int256(6), int256(30), int256(-52), int256(12), int256(-34), int256(27), int256(-16), int256(3), int256(-38), int256(-34), int256(11), int256(35), int256(-21), int256(-34), int256(-46), int256(-24), int256(42), int256(-20), int256(-12), int256(32), int256(5), int256(-1), int256(-6), int256(3), int256(16), int256(-24), int256(-110), int256(2), int256(67), int256(-82), int256(0), int256(-22), int256(21), int256(21), int256(0), int256(12), int256(-32), int256(38), int256(-9), int256(-31), int256(-57), int256(1), int256(-91), int256(36), int256(-9), int256(-66), int256(5), int256(12), int256(-49), int256(39), int256(18), int256(1), int256(3), int256(-51), int256(-44), int256(-74), int256(-20), int256(13), int256(0), int256(-61), int256(4), int256(-42), int256(-127), int256(-18), int256(-27), int256(-9), int256(40), int256(-19), int256(55), int256(7), int256(-50), int256(63), int256(-3), int256(0), int256(0), int256(19), int256(14), int256(-45), int256(-3), int256(14), int256(13), int256(-3), int256(-18), int256(36), int256(-9), int256(4), int256(-5), int256(-23), int256(10), int256(9), int256(0), int256(25), int256(-33), int256(-37), int256(47), int256(-40), int256(-26), int256(-50), int256(-37), int256(30), int256(21), int256(-66), int256(-16), int256(83), int256(-50), int256(85), int256(-7), int256(-47), int256(-59), int256(22), int256(2), int256(-4), int256(-14), int256(13), int256(15), int256(-64), int256(25), int256(13), int256(9), int256(25), int256(49), int256(2), int256(-7), int256(-8), int256(-2), int256(25), int256(28), int256(-62), int256(26), int256(3), int256(-17), int256(-48), int256(-31), int256(-6), int256(-52), int256(-60), int256(22), int256(-21), int256(-8), int256(28), int256(-5), int256(-14), int256(-13), int256(28)];
    }

    function _b0() internal pure returns (int256[32] memory m) {
        m = [int256(-199), int256(-49), int256(268), int256(-1222), int256(-63), int256(728), int256(-122), int256(-699), int256(-2266), int256(82), int256(-1888), int256(228), int256(-690), int256(-274), int256(-1006), int256(-1901), int256(-1091), int256(-338), int256(-429), int256(-682), int256(-119), int256(-882), int256(-304), int256(-657), int256(-1059), int256(-909), int256(-735), int256(-1916), int256(158), int256(-1535), int256(134), int256(-165)];
    }

    function _w1() internal pure returns (int256[32] memory m) {
        m = [int256(63), int256(-21), int256(-21), int256(66), int256(27), int256(-53), int256(24), int256(-44), int256(-68), int256(-12), int256(127), int256(-51), int256(-30), int256(46), int256(77), int256(93), int256(38), int256(-39), int256(40), int256(-30), int256(-40), int256(31), int256(34), int256(53), int256(-49), int256(-45), int256(-40), int256(-51), int256(22), int256(43), int256(-27), int256(42)];
    }

    function _b1() internal pure returns (int256) {
        return -32265;
    }

    /// @notice 0 = worst, 1000 = best credit. Reject below the pool threshold (500 here). Monotone in the logit; clamp to +-4 sigma.
    function score(int256[10] calldata f) public pure returns (uint16) {
        int256[10] memory mu = _mu();
        int256[10] memory sd = _sd();
        int256[10] memory z;
        unchecked {
        for (uint256 i; i < 10; ++i) {
            int256 v = ((f[i] * 1000 - mu[i]) * 16) / sd[i];
            if (v > 127) v = 127;
            else if (v < -127) v = -127;
            z[i] = v;
        }
        }

        int256[320] memory w0 = _w0();
        int256[32] memory b0 = _b0();
        int256[32] memory h;
        unchecked {
        for (uint256 j; j < 32; ++j) {
            int256 acc = b0[j];
            for (uint256 i; i < 10; ++i) {
                acc += z[i] * w0[i * 32 + j];
            }
            h[j] = acc > 0 ? acc : int256(0);
        }
        }

        int256[32] memory w1 = _w1();
        int256 logit = _b1();
        unchecked {
        for (uint256 j; j < 32; ++j) {
            logit += h[j] * w1[j];
        }
        }

        int256 s = 500 - (logit * 1000) / (LOGIT_SCALE * 8);
        if (s < 0) s = 0;
        else if (s > 1000) s = 1000;
        return uint16(uint256(s));
    }

    function scoreBatch(int256[10][] calldata fs) external pure returns (uint16[] memory out) {
        out = new uint16[](fs.length);
        for (uint256 i; i < fs.length; ++i) out[i] = score(fs[i]);
    }
}
