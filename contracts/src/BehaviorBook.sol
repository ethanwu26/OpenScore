// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  BehaviorBook — the only source of model features.
/// @notice Records what a lending pool observes about each borrower (age, settled
///         periods, delays, repayment totals, exposure). Nothing here is self-reported
///         and nothing comes from an oracle: the pool writes it while settling loans.
/// @dev    Only the pool may write. A 6-period ring keeps the recent window bounded,
///         so features() is O(6) regardless of how long an address has been alive.
contract BehaviorBook {
    uint256 public constant WINDOW = 6;
    uint256 public constant MAX_DELAY = 8;
    uint256 public constant MAX_UTIL = 2000; // per-mille, 2.0x limit

    struct Ring {
        uint128[6] owed;
        uint128[6] paid;
        uint8[6] delay;
    }

    struct Profile {
        uint64 firstSeen;
        uint32 periods;
        uint128 owedTotal;
        uint128 paidTotal;
        uint128 limit; // credit line used for utilisation, in tUSD units
        uint32 defaults; // liquidations, never decays with the ring
        uint64 lastDefault;
        Ring ring;
    }

    address public pool;
    address public immutable deployer;

    mapping(address => Profile) internal profiles;

    event PoolSet(address indexed pool);
    event PeriodRecorded(address indexed user, uint32 period, uint128 owed, uint128 paid, uint8 delay);
    event LimitSet(address indexed user, uint128 limit);
    event DefaultNoted(address indexed user, uint32 defaults, uint64 at);

    error OnlyPool();
    error AlreadySet();

    constructor() {
        deployer = msg.sender;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    function setPool(address p) external {
        if (msg.sender != deployer || pool != address(0)) revert AlreadySet();
        pool = p;
        emit PoolSet(p);
    }

    function touch(address user) external onlyPool {
        if (profiles[user].firstSeen == 0) profiles[user].firstSeen = uint64(block.timestamp);
    }

    function setLimit(address user, uint128 limit) external onlyPool {
        profiles[user].limit = limit;
        emit LimitSet(user, limit);
    }

    /// @param delay how many periods overdue this settlement was (0 = on time)
    function record(address user, uint128 owed, uint128 paid, uint8 delay) external onlyPool {
        Profile storage p = profiles[user];
        if (p.firstSeen == 0) p.firstSeen = uint64(block.timestamp);
        if (delay > MAX_DELAY) delay = uint8(MAX_DELAY);

        uint32 idx = p.periods % 6;
        p.ring.owed[idx] = owed;
        p.ring.paid[idx] = paid;
        p.ring.delay[idx] = delay;

        p.owedTotal += owed;
        p.paidTotal += paid;
        p.periods += 1;
        if (owed > p.limit) p.limit = owed;

        emit PeriodRecorded(user, p.periods, owed, paid, delay);
    }

    function firstSeenOf(address user) external view returns (uint64) {
        return profiles[user].firstSeen;
    }

    function periodsOf(address user) external view returns (uint32) {
        return profiles[user].periods;
    }

    /// @notice A liquidation is permanent history: it must not decay out of the ring.
    function noteDefault(address user) external onlyPool {
        Profile storage p = profiles[user];
        p.defaults += 1;
        p.lastDefault = uint64(block.timestamp);
        emit DefaultNoted(user, p.defaults, uint64(block.timestamp));
    }

    function defaultsOf(address user) external view returns (uint32) {
        return profiles[user].defaults;
    }

    function lastDefaultOf(address user) external view returns (uint64) {
        return profiles[user].lastDefault;
    }

    /// @notice The 10 features the model consumes. Same order as RiskModel.
    function features(address user, uint128 collateral) public view returns (int256[10] memory f) {
        Profile storage p = profiles[user];
        uint32 per = p.periods;
        uint128 lim = p.limit == 0 ? 1 : p.limit;

        uint256 delayMax;
        uint256 delayCount;
        uint256 zeroPay;
        uint256 utilMax;
        uint128 lastOwed;
        uint128 lastPaid;
        uint128 owed6;

        uint256 n = per < 6 ? per : 6;
        for (uint256 i; i < n; ++i) {
            uint32 idx = uint32((uint256(per) - 1 - i) % 6);
            uint128 o = p.ring.owed[idx];
            uint128 pd = p.ring.paid[idx];
            uint256 d = p.ring.delay[idx];
            if (d > delayMax) delayMax = d;
            if (d >= 1) delayCount += 1;
            if (pd == 0 && o > 0) zeroPay += 1;
            uint256 u = (uint256(o) * 1000) / lim;
            if (u > utilMax) utilMax = u;
            if (i == 0) {
                lastOwed = o;
                lastPaid = pd;
            }
            if (per >= 6 && i == 5) owed6 = o;
        }
        if (per < 6) owed6 = p.ring.owed[0];

        // f0 address age in days
        uint256 ageDays;
        if (p.firstSeen != 0) {
            ageDays = (block.timestamp - p.firstSeen) / 1 days;
            if (ageDays > 3650) ageDays = 3650;
        }
        f[0] = int256(ageDays);
        // f1 locked collateral, in the model's unit (1 = 100 tUSD), capped at the
        // training range so an outlier cannot push the score around.
        uint256 col = uint256(collateral) / 100e18;
        f[1] = int256(col > 10000 ? 10000 : col);
        // f2 worst delay
        f[2] = int256(delayMax);
        // f3 periods with any delay
        f[3] = int256(delayCount);
        // f4 cumulative repaid / owed, per-mille
        // no history is a zero repayment record, not a perfect one
        uint256 ratio = p.owedTotal == 0 ? 0 : (uint256(p.paidTotal) * 1000) / p.owedTotal;
        f[4] = int256(ratio > 1000 ? 1000 : ratio);
        // f5 current utilisation
        uint256 util = (uint256(lastOwed) * 1000) / lim;
        f[5] = int256(util > MAX_UTIL ? MAX_UTIL : util);
        // f6 periods with a zero payment
        f[6] = int256(zeroPay);
        // f7 latest repaid / owed
        uint256 lastRatio = lastOwed == 0 ? 0 : (uint256(lastPaid) * 1000) / lastOwed;
        f[7] = int256(lastRatio > 1000 ? 1000 : lastRatio);
        // f8 exposure drift over the window, signed
        int256 trend = (int256(uint256(lastOwed)) - int256(uint256(owed6))) * 1000 / int256(uint256(lim));
        if (trend > 500) trend = 500;
        else if (trend < -500) trend = -500;
        f[8] = trend;
        // f9 worst utilisation in the window
        f[9] = int256(utilMax > MAX_UTIL ? MAX_UTIL : utilMax);
    }
}
