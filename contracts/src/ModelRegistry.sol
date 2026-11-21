// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IScoreModel {
    function score(int256[10] calldata f) external view returns (uint16);
}

/// @title  ModelRegistry — a market for on-chain score models, plus a randomised audit.
/// @notice A model is an address. Registration pins its codehash and a reference set
///         (inputs the author published with the scores their trained model produced).
///         Anyone can then run a seeded audit: pick k reference inputs at random from
///         block data and require the deployed contract to reproduce the committed
///         scores. This is what catches the three ways "weights go wrong" without
///         trusting the author: a wrong deployment, a silently upgraded proxy, and
///         quantisation drift between the trained and the deployed weights.
/// @dev    Seed fairness is irrelevant here — the audit must pass for every draw, so
///         there is nothing to bribe. Using block data only makes the draw unpredictable.
contract ModelRegistry {
    struct Model {
        address model;
        address author;
        uint96 fee; // tUSD units charged per score() call
        bytes32 codehash;
        uint32 n;
        bool failed;
        uint32 auditsPassed;
        uint32 auditsFailed;
        int256[10][] inputs;
        uint16[] scores;
    }

    address public immutable deployer;
    Model[] internal models;
    uint256 public auditNonce;

    event Registered(uint32 indexed id, address indexed model, address indexed author, uint96 fee, uint32 n);
    event AuditPassed(uint32 indexed id, uint32 k, uint256 seed, uint256 maxDev);
    event AuditFailed(uint32 indexed id, uint32 index, uint256 expected, uint256 actual, uint256 dev, string reason);
    event DeviationMeasured(uint32 indexed id, uint32 k, uint32 maxDev, uint32 sumDev);

    error BadArgs();
    error UnknownModel();
    error NotAuthor();

    constructor() {
        deployer = msg.sender;
    }

    function count() external view returns (uint256) {
        return models.length;
    }

    /// @param inputs 4..64 reference feature vectors, same order as `scores`
    /// @param scores what the trained model outputs for each input, 0..1000
    function register(address model, uint96 fee, int256[10][] calldata inputs, uint16[] calldata scores)
        external
        returns (uint32 id)
    {
        uint256 n = inputs.length;
        if (n < 4 || n > 64 || n != scores.length) revert BadArgs();
        for (uint256 i; i < n; ++i) {
            if (scores[i] > 1000) revert BadArgs();
        }
        id = uint32(models.length);
        Model storage m = models.push();
        m.model = model;
        m.author = msg.sender;
        m.fee = fee;
        m.codehash = model.codehash;
        m.n = uint32(n);
        for (uint256 i; i < n; ++i) {
            m.inputs.push(inputs[i]);
            m.scores.push(scores[i]);
        }
        emit Registered(id, model, msg.sender, fee, uint32(n));
    }

    /// @notice Draw k inputs with a seed nobody can predict and compare on-chain output
    ///         with the committed score. A single mismatch freezes the model for good.
    function audit(uint32 id, uint32 k) external returns (bool ok) {
        return auditTol(id, k, 0);
    }

    /// @notice Same as audit, but a sampled score may be off by up to `tol` points.
    /// @dev    tol = 0 is the recommendation: the reference set is produced by the same
    ///         integer model, so an honest deployment deviates by exactly 0 and every
    ///         point of tolerance is budget handed to a drifting model.
    function auditTol(uint32 id, uint32 k, uint16 tol) public returns (bool ok) {
        if (id >= models.length) revert UnknownModel();
        Model storage m = models[id];
        if (k == 0 || k > m.n) revert BadArgs();
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, block.number, auditNonce++)));
        (bool passed, uint32 badIndex, uint256 maxDev, string memory reason) = _check(id, seed, k, tol);
        if (passed) {
            m.auditsPassed += 1;
            emit AuditPassed(id, k, seed, maxDev);
            return true;
        }
        uint256 expected = badIndex < m.n ? m.scores[badIndex] : 0;
        uint256 actual;
        try IScoreModel(m.model).score(m.inputs[badIndex]) returns (uint16 v) {
            actual = v;
        } catch {}
        m.failed = true;
        m.auditsFailed += 1;
        uint256 dev = expected > actual ? expected - actual : actual - expected;
        emit AuditFailed(id, badIndex, expected, actual, dev, reason);
        return false;
    }

    /// @notice Deterministic worst case over the whole reference set. This is the number
    ///         a threshold must be set against; the seeded audit only samples it.
    function fullDeviation(uint32 id) public view returns (uint32 maxDev, uint32 sumDev) {
        if (id >= models.length) revert UnknownModel();
        Model storage m = models[id];
        for (uint256 i; i < m.n; ++i) {
            uint256 expected = m.scores[i];
            uint256 actual;
            try IScoreModel(m.model).score(m.inputs[i]) returns (uint16 v) {
                actual = v;
            } catch {
                return (type(uint32).max, type(uint32).max);
            }
            uint256 dev = expected > actual ? expected - actual : actual - expected;
            if (dev > maxDev) maxDev = uint32(dev);
            sumDev += uint32(dev);
        }
    }

    /// @notice Read-only deviation report for a given seed: what a pool would see.
    function measureDeviation(uint32 id, uint32 k, uint256 seed)
        public
        view
        returns (uint32 maxDev, uint32 sumDev, bool withinZero)
    {
        if (id >= models.length) revert UnknownModel();
        if (k == 0 || k > models[id].n) revert BadArgs();
        (bool ok, , uint256 mx, ) = _check(id, seed, k, 0);
        return (uint32(mx), _sumDev(id, seed, k), ok);
    }

    function _sumDev(uint32 id, uint256 seed, uint32 k) internal view returns (uint32 sum) {
        Model storage m = models[id];
        for (uint256 j; j < k; ++j) {
            uint256 idx = uint256(keccak256(abi.encode(seed, j))) % m.n;
            uint256 actual;
            try IScoreModel(m.model).score(m.inputs[idx]) returns (uint16 v) {
                actual = v;
            } catch {}
            uint256 e = m.scores[idx];
            sum += uint32(e > actual ? e - actual : actual - e);
        }
    }

    /// @notice Same draw, read-only, for the frontend to show before signing.
    function preview(uint32 id, uint32 k, uint256 seed) external view returns (bool ok, uint32 badIndex) {
        if (id >= models.length) revert UnknownModel();
        if (k == 0 || k > models[id].n) revert BadArgs();
        (ok, badIndex, , ) = _check(id, seed, k, 0);
    }

    function _check(uint32 id, uint256 seed, uint32 k, uint16 tol)
        internal
        view
        returns (bool ok, uint32 badIndex, uint256 maxDev, string memory reason)
    {
        Model storage m = models[id];
        if (m.failed) return (false, 0, 0, "model already failed");
        if (m.model.codehash != m.codehash) return (false, 0, 0, "codehash changed");
        for (uint256 j; j < k; ++j) {
            uint256 idx = uint256(keccak256(abi.encode(seed, j))) % m.n;
            uint256 expected = m.scores[idx];
            uint256 actual;
            try IScoreModel(m.model).score(m.inputs[idx]) returns (uint16 s) {
                actual = s;
            } catch {
                actual = type(uint256).max;
            }
            uint256 dev = expected > actual ? expected - actual : actual - expected;
            if (dev > maxDev) maxDev = dev;
            if (dev > tol) return (false, uint32(idx), maxDev, "deviation over threshold");
        }
        return (true, 0, maxDev, "");
    }

    /// @notice A pool must refuse a model that ever failed an audit.
    function isUsable(uint32 id) external view returns (bool) {
        if (id >= models.length) return false;
        Model storage m = models[id];
        return !m.failed && m.model != address(0) && m.model.codehash == m.codehash;
    }

    function modelOf(uint32 id) external view returns (address) {
        if (id >= models.length) revert UnknownModel();
        return models[id].model;
    }

    function feeOf(uint32 id) external view returns (uint96) {
        if (id >= models.length) revert UnknownModel();
        return models[id].fee;
    }

    function authorOf(uint32 id) external view returns (address) {
        if (id >= models.length) revert UnknownModel();
        return models[id].author;
    }

    function info(uint32 id)
        external
        view
        returns (address model, address author, uint96 fee, uint32 n, bool failed, uint32 passed, uint32 failedCount)
    {
        if (id >= models.length) revert UnknownModel();
        Model storage m = models[id];
        return (m.model, m.author, m.fee, m.n, m.failed, m.auditsPassed, m.auditsFailed);
    }

    function refAt(uint32 id, uint32 i)
        external
        view
        returns (int256[10] memory input, uint16 expected)
    {
        if (id >= models.length) revert UnknownModel();
        Model storage m = models[id];
        input = m.inputs[i];
        expected = m.scores[i];
    }
}
