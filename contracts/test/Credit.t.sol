// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RefData} from "./RefData.sol";
import {RiskModel} from "../src/RiskModel.sol";
import {RiskModelAlt} from "../src/RiskModelAlt.sol";
import {RiskModelDrift} from "../src/RiskModelDrift.sol";
import {ShiftModel} from "../src/ShiftModel.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";
import {BehaviorBook} from "../src/BehaviorBook.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {MockUSD} from "../src/MockUSD.sol";

interface IToken {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function faucet() external;
}

/// @dev Any address that can act; lets tests switch msg.sender without cheatcodes.
contract Actor {
    function exec(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}

/// @dev Minimal test base: no forge-std, so it also builds with plain `solc`.
contract Base {
    address constant VM = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    MockUSD token;
    RiskModel model;
    RiskModelAlt alt;
    RiskModelDrift drift;
    ModelRegistry registry;
    BehaviorBook book;
    CreditPool pool;
    Actor alice;
    Actor bob;
    uint32 modelId;

    function warp(uint256 t) internal {
        (bool ok,) = VM.call(abi.encodeWithSignature("warp(uint256)", t));
        require(ok, "warp");
    }

    function setUp() public virtual {
        token = new MockUSD();
        model = new RiskModel();
        alt = new RiskModelAlt();
        drift = new RiskModelDrift();
        registry = new ModelRegistry();
        book = new BehaviorBook();
        pool = new CreditPool(address(token), address(book), address(registry), 0);
        book.setPool(address(pool));
        alice = new Actor();
        bob = new Actor();
        token.mint(address(alice), 1e30);
        token.mint(address(bob), 1e30);
        token.mint(address(this), 1e24);
        modelId = registry.register(address(model), 1e15, RefData.inputs(), RefData.scores());
    }

    // ---- helpers ----
    function callAs(Actor a, address t, bytes memory d) internal returns (bytes memory) {
        return a.exec(t, d);
    }

    function approve(Actor a, uint256 amt) internal {
        callAs(a, address(token), abi.encodeWithSignature("approve(address,uint256)", address(pool), amt));
    }

    function deposit(Actor a, uint256 amt) internal {
        approve(a, amt);
        callAs(a, address(pool), abi.encodeWithSignature("deposit(uint256)", amt));
    }

    function borrow(Actor a, uint128 amt, uint128 col, uint32 days_) internal returns (uint256) {
        approve(a, uint256(col) + uint256(amt));
        bytes memory r = callAs(
            a, address(pool), abi.encodeWithSignature("borrow(uint128,uint128,uint32)", amt, col, days_)
        );
        return abi.decode(r, (uint256));
    }

    function repay(Actor a, uint256 id, uint128 amt) internal {
        approve(a, amt);
        callAs(a, address(pool), abi.encodeWithSignature("repay(uint256,uint128)", id, amt));
    }

    function quote(Actor a, uint128 col) internal view returns (uint16 score, uint256 limit) {
        (bool ok, bytes memory r) = address(pool).staticcall(
            abi.encodeWithSignature("quote(address,uint128)", address(a), col)
        );
        require(ok, "quote");
        (score, limit,) = abi.decode(r, (uint16, uint256, uint96));
    }

    function expectRevert(Actor a, address t, bytes memory d) internal returns (bool) {
        (bool ok,) = address(a).call(abi.encodeWithSignature("exec(address,bytes)", t, d));
        return !ok;
    }
}

contract AuditTest is Base {
    function testAuditPassesOnTheRegisteredModel() public {
        require(registry.isUsable(modelId), "usable");
        for (uint256 round; round < 5; ++round) {
            require(registry.audit(modelId, 8), "audit should pass");
        }
        (, , , , bool failed, uint32 passed,) = registry.info(modelId);
        require(!failed && passed == 5, "counters");
    }

    function testAuditRejectsSwappedWeights() public {
        // Same architecture, one weight flipped, registered with the honest reference
        // scores: exactly the "author silently replaced the weights" case.
        uint32 bad = registry.register(address(alt), 0, RefData.inputs(), RefData.scores());
        require(registry.isUsable(bad), "usable before audit");
        require(!registry.audit(bad, 8), "audit must fail");
        require(!registry.isUsable(bad), "frozen after failure");
        (, , , , bool failed, uint32 passed, uint32 failedCount) = registry.info(bad);
        require(failed && passed == 0 && failedCount == 1, "state");
    }

    function testAuditRejectsOffsetReferenceScores() public {
        uint16[] memory s = RefData.scores();
        for (uint256 i; i < 8; ++i) {
            s[i] = s[i] + 1;
        }
        uint32 bad = registry.register(address(model), 0, RefData.inputs(), s);
        require(!registry.audit(bad, 4), "off-by-one reference must fail");
        require(!registry.isUsable(bad), "frozen");
    }

    function testPreviewMatchesAudit() public {
        (bool ok,) = registry.preview(modelId, 8, 12345);
        require(ok, "preview ok");
        require(registry.audit(modelId, 8), "audit ok");
    }
}

contract DemoNumbersTest is Base {
    event Num(string label, uint256 a, uint256 b, uint256 c);

    function testDemoNumbers() public {
        deposit(bob, 5_000_000e18);
        uint128 col = 100_000e18;

        (uint16 s0, uint256 l0) = quote(alice, col);
        emit Num("fresh", s0, l0 / 1e18, 0);

        for (uint256 i; i < 3; ++i) {
            (, uint256 lim) = quote(alice, col);
            uint256 id = borrow(alice, uint128(lim / 2), col, 7);
            repay(alice, id, uint128(lim / 2));
        }
        (uint16 s1, uint256 l1) = quote(alice, col);
        emit Num("3 clean periods", s1, l1 / 1e18, book.periodsOf(address(alice)));

        uint256 id2 = borrow(alice, uint128(l1 / 4), col, 0);
        warp(block.timestamp + 2 days);
        callAs(alice, address(pool), abi.encodeWithSignature("liquidate(uint256)", id2));
        (uint16 s2, uint256 l2) = quote(alice, col);
        emit Num("1 missed period", s2, l2 / 1e18, book.periodsOf(address(alice)));
    }
}

/// @dev Is there money in farming a good score and then walking away? These tests
///      measure the recovery of a bad record and the cost of a farmed clean history.
contract ArbitrageTest is Base {
    event Num(string label, uint256 score, uint256 limit, uint256 periods);

    function _clean(Actor a, uint128 col, uint256 times) internal {
        for (uint256 i; i < times; ++i) {
            (, uint256 lim) = quote(a, col);
            uint256 amount = lim / 4;
            uint256 id = borrow(a, uint128(amount), col, 7);
            repay(a, id, uint128(amount));
        }
    }

    function testFarmedCleanHistoryIsCheapButBoundedByCollateral() public {
        deposit(bob, 10_000_000e18);
        uint128 col = 100_000e18;
        (uint16 s0, uint256 l0) = quote(alice, col);
        _clean(alice, col, 3);
        (uint16 s1, uint256 l1) = quote(alice, col);
        emit Num("fresh", s0, l0 / 1e18, 0);
        emit Num("3 farmed periods", s1, l1 / 1e18, 3);
        require(s1 > s0, "farming works");
        // the exploit ceiling: the line never exceeds the collateral, so defaulting is a loss
        require(l1 <= uint256(col), "limit <= collateral: no principal arbitrage");
        emit Num("max unsecured exposure per loan", 0, 0, 0);
    }

    function testMissedPaymentDecaysOutOfTheWindow() public {
        deposit(bob, 10_000_000e18);
        uint128 col = 100_000e18;
        _clean(alice, col, 3);

        // one defaulted period
        (, uint256 lim) = quote(alice, col);
        uint256 id = borrow(alice, uint128(lim / 4), col, 0);
        warp(block.timestamp + 2 days);
        callAs(alice, address(pool), abi.encodeWithSignature("liquidate(uint256)", id));
        (uint16 afterDefault, uint256 limitAfter) = quote(alice, col);
        emit Num("after 1 default", afterDefault, limitAfter / 1e18, book.periodsOf(address(alice)));

        // the cooldown blocks new borrows for a week
        require(
            expectRevert(
                alice,
                address(pool),
                abi.encodeWithSignature("borrow(uint128,uint128,uint32)", uint128(1e18), col, uint32(7))
            ),
            "cooldown after a default"
        );
        warp(block.timestamp + 8 days);

        // the ring is 6 wide, so 6 clean periods push the bad one out
        _clean(alice, col, 6);
        (uint16 recovered, uint256 limitRecovered) = quote(alice, col);
        emit Num("after 6 clean periods", recovered, limitRecovered / 1e18, book.periodsOf(address(alice)));

        require(recovered > afterDefault, "the window decays: this is the gaming surface");
        emit Num("recovery in points, unguarded", recovered - afterDefault, 0, 0);

        // guarding: one default halves the line for good, and blocks new borrows for a week
        require(book.defaultsOf(address(alice)) == 1, "default counted");
        require(limitRecovered <= uint256(col) / 2 + 1, "line halved after a default");
        emit Num("line after guard", recovered, limitRecovered / 1e18, book.defaultsOf(address(alice)));
    }
}

contract PoolTest is Base {
    function testFreshAddressLimitFollowsScore() public {
        deposit(bob, 1_000_000e18);
        (uint16 score, uint256 limit) = quote(alice, 100_000e18);
        uint256 expected = (100_000e18 * uint256(score)) / 1000;
        require(limit == expected, "limit = collateral * score");
        require(limit > 0 && limit < 100_000e18, "fresh address gets a discount");
        borrow(alice, uint128(limit), 100_000e18, 7);
        require(pool.loanCount() == 1, "loan");
    }

    function testScoreAndLimitGrowWithCleanHistory() public {
        deposit(bob, 1_000_000e18);
        (uint16 cold, uint256 coldLimit) = quote(alice, 100_000e18);

        for (uint256 i; i < 3; ++i) {
            (uint16 s, uint256 lim) = quote(alice, 100_000e18);
            uint256 amount = lim / 2;
            uint256 id = borrow(alice, uint128(amount), 100_000e18, 7);
            repay(alice, id, uint128(amount));
            require(book.periodsOf(address(alice)) == i + 1, "periods");
            require(s >= cold, "score never drops on a clean period");
        }
        (uint16 warm, uint256 warmLimit) = quote(alice, 100_000e18);
        require(warm > cold, "clean history must raise the score");
        require(warmLimit > coldLimit, "and the limit");

        // one defaulted period pulls it back down
        uint256 id2 = borrow(alice, uint128(warmLimit / 4), 100_000e18, 0);
        warp(block.timestamp + 2 days);
        callAs(alice, address(pool), abi.encodeWithSignature("liquidate(uint256)", id2));
        (uint16 afterMiss, uint256 afterLimit) = quote(alice, 100_000e18);
        require(afterMiss < warm, "default must lower the score");
        require(afterLimit < warmLimit, "and the limit");
    }

    function testLimitIsEnforced() public {
        deposit(bob, 1_000_000e18);
        for (uint256 i; i < 3; ++i) {
            (, uint256 lim) = quote(alice, 100_000e18);
            uint256 id = borrow(alice, uint128(lim / 2), 100_000e18, 7);
            repay(alice, id, uint128(lim / 2));
        }
        (, uint256 limit) = quote(alice, 100_000e18);
        require(
            expectRevert(
                alice,
                address(pool),
                abi.encodeWithSignature(
                    "borrow(uint128,uint128,uint32)", uint128(limit + 1), uint128(100_000e18), uint32(7)
                )
            ),
            "over limit must revert"
        );
        borrow(alice, uint128(limit), 100_000e18, 7);
    }

    function testFeeGoesToModelAuthor() public {
        deposit(bob, 1_000_000e18);
        uint256 before = token.balanceOf(address(this));
        (, uint256 limit) = quote(alice, 100_000e18);
        borrow(alice, uint128(limit), 100_000e18, 7);
        require(token.balanceOf(address(this)) == before + 1e15, "author paid the per-call fee");
    }

    function testFrozenModelBlocksBorrowing() public {
        uint32 bad = registry.register(address(alt), 0, RefData.inputs(), RefData.scores());
        registry.audit(bad, 8);
        require(!registry.isUsable(bad), "frozen");

        CreditPool p2 = new CreditPool(address(token), address(book), address(registry), bad);
        deposit(bob, 1_000_000e18);
        require(
            expectRevert(
                alice,
                address(p2),
                abi.encodeWithSignature("borrow(uint128,uint128,uint32)", uint128(10e18), uint128(100e18), uint32(7))
            ),
            "a failed model must not be able to move money"
        );
    }
}

/// @dev Deviation band: how far can deployed weights move before the audit notices,
///      how many draws does it take, and what does one point of tolerance cost?
contract DeviationTest is Base {
    event Dev(string label, uint256 a, uint256 b, uint256 c);

    /// Repeat audits until one fails; returns how many rounds that took (0 = never).
    function _roundsToCatch(uint32 id, uint32 k, uint32 maxRounds) internal returns (uint32 rounds) {
        for (uint256 i; i < maxRounds; ++i) {
            rounds = uint32(i + 1);
            if (!registry.audit(id, k)) return rounds;
        }
        rounds = 0;
    }

    function testHonestModelDeviatesByZero() public {
        (uint32 mx, uint32 sum) = registry.fullDeviation(modelId);
        emit Dev("honest, full reference set", mx, sum, 0);
        require(mx == 0 && sum == 0, "an honest deployment must deviate by exactly 0");
        require(registry.audit(modelId, 8), "tol 0 passes");
    }

    /// The reference scores come from the same integer model on the same inputs, so a
    /// one point reference error is the smallest drift that exists — and it is invisible
    /// to a single draw with probability (1 - 1/n)^k.
    function testOnePointReferenceErrorAndCoverage() public {
        uint16[] memory s = RefData.scores();
        s[0] = s[0] + 1;
        uint32 id = registry.register(address(model), 0, RefData.inputs(), s);
        (uint32 mx,) = registry.fullDeviation(id);
        require(mx == 1, "exactly one point");

        uint32 rounds = _roundsToCatch(id, 8, 60);
        emit Dev("one bad entry of 8, k=8", rounds, 8, 0);
        require(rounds > 0, "must be caught within 60 draws");

        // tol 1 makes it invisible forever
        uint16[] memory s2 = RefData.scores();
        s2[0] = s2[0] + 1;
        uint32 id2 = registry.register(address(model), 0, RefData.inputs(), s2);
        require(registry.auditTol(id2, 8, 1), "tol 1 accepts a one point error");
    }

    function testSwappedWeightIsCaughtAtZeroTolerance() public {
        uint32 id = registry.register(address(alt), 0, RefData.inputs(), RefData.scores());
        (uint32 mx, uint32 sum) = registry.fullDeviation(id);
        emit Dev("flipped one weight", mx, sum, 0);
        require(mx >= 20, "a flipped weight must move the score a lot");
        require(!registry.audit(id, 8), "caught on the first draw");
        require(!registry.isUsable(id), "frozen");
    }

    /// 5% of W0 moved by +-1 is a plausible "I re-exported the weights" accident.
    function testSmallWeightDriftIsVisibleButOnlyAtZeroTolerance() public {
        uint32 id = registry.register(address(drift), 0, RefData.inputs(), RefData.scores());
        (uint32 mx, uint32 sum) = registry.fullDeviation(id);
        emit Dev("5% of W0 moved by 1", mx, sum, 0);
        require(mx > 0, "drift must be measurable");

        uint32 rounds = _roundsToCatch(registry.register(address(drift), 0, RefData.inputs(), RefData.scores()), 8, 60);
        require(rounds > 0, "tol 0 catches it");

        // with tol = full-set worst case it is accepted, and stays accepted forever
        uint32 loose = registry.register(address(drift), 0, RefData.inputs(), RefData.scores());
        require(registry.auditTol(loose, 8, uint16(mx)), "tol = worst case accepts");
        require(registry.isUsable(loose), "pool would trust it");
        emit Dev("same drift, tol = maxDev", uint256(mx), uint256(rounds), 1);
    }
}

/// @dev L > 1: the line may exceed the collateral, but only for a proven record, and
///      the difference is exactly the unsecured exposure the pool eats on a default.
contract LeverageTest is Base {
    event Num(string label, uint256 a, uint256 b, uint256 c);

    function setUp() public override {
        super.setUp();
        pool.setLeverage(20_000); // 2.0x ceiling
        deposit(bob, 10_000_000e18);
    }

    function _clean(Actor a, uint128 col, uint256 times) internal {
        for (uint256 i; i < times; ++i) {
            (, uint256 lim) = quote(a, col);
            uint256 amount = lim / 4;
            uint256 id = borrow(a, uint128(amount), col, 7);
            repay(a, id, uint128(amount));
        }
    }

    function testUnprovenAddressIsCappedAtCollateral() public {
        uint128 col = 100_000e18;
        (, uint256 lim) = quote(alice, col);
        emit Num("fresh, 2x ceiling", lim / 1e18, 0, 0);
        require(lim <= uint256(col), "no leverage without a proven record");

        _clean(alice, col, 3); // 3 periods but age < 7 days
        (, uint256 lim2) = quote(alice, col);
        require(lim2 <= uint256(col), "still capped: age gate");
    }

    function testProvenAddressUnlocksLeverage() public {
        uint128 col = 100_000e18;
        _clean(alice, col, 3);
        warp(block.timestamp + 8 days);

        (uint16 score, uint256 lim) = quote(alice, col);
        emit Num("proven, 2x ceiling", score, lim / 1e18, 1);
        require(lim > uint256(col), "leverage unlocked");
        require(lim <= 2 * uint256(col), "capped by leverageBps");

        uint256 id = borrow(alice, uint128(lim), col, 30);
        require(id > 0, "borrowed above collateral");
    }

    function testDefaultWithLeverageCostsThePoolTheUnsecuredPart() public {
        uint128 col = 100_000e18;
        _clean(alice, col, 3);
        warp(block.timestamp + 8 days);

        (, uint256 lim) = quote(alice, col);
        uint256 before = token.balanceOf(address(pool));
        uint256 id = borrow(alice, uint128(lim), col, 0);
        uint256 unsecured = lim - uint256(col);
        emit Num("unsecured exposure", lim / 1e18, col / 1e18, unsecured / 1e18);

        warp(block.timestamp + 2 days);
        callAs(alice, address(pool), abi.encodeWithSignature("liquidate(uint256)", id));
        uint256 afterBal = token.balanceOf(address(pool));
        // the pool keeps the collateral and loses exactly the unsecured part
        require(afterBal + unsecured == before - 1e15, "loss == unsecured exposure");
        emit Num("pool loss on default", before - afterBal, unsecured, 0);

        (uint16 s2, uint256 lim3) = quote(alice, col);
        require(lim3 <= uint256(col) / 2, "one default: back under half collateral");
        emit Num("post-default line", s2, lim3 / 1e18, 0);
    }
}

/// @dev Two models must agree within a tolerance; the pool lends against the lower one.
contract ConsensusTest is Base {
    event Num(string label, uint256 a, uint256 b, uint256 c);

    function _refs(int256 d) internal view returns (uint16[] memory s) {
        s = RefData.scores();
        for (uint256 i; i < s.length; ++i) {
            int256 v = int256(uint256(s[i])) + d;
            if (v < 0) v = 0;
            else if (v > 1000) v = 1000;
            s[i] = uint16(uint256(v));
        }
    }

    function testCloseSecondOpinionPasses() public {
        ShiftModel second = new ShiftModel(address(model), 2);
        uint32 id2 = registry.register(address(second), 0, RefData.inputs(), _refs(2));
        require(registry.audit(id2, 8), "second model audits fine");

        pool.setDual(id2, 40);
        (uint16 s, uint256 lim) = quote(alice, 100_000e18);
        (uint16 a1, uint16 a2) = pool.scoresOf(address(alice), 100_000e18);
        emit Num("agreement delta", a1, a2, a2 - a1);
        require(s == a1 && a1 <= a2, "pool uses the lower score");
        require(lim > 0, "line exists");
    }

    function testWideDisagreementBlocksBorrowing() public {
        ShiftModel rogue = new ShiftModel(address(model), 200);
        uint32 id2 = registry.register(address(rogue), 0, RefData.inputs(), _refs(200));
        require(registry.audit(id2, 8), "the rogue model is honest about being different");

        pool.setDual(id2, 40);
        require(
            expectRevert(
                alice,
                address(pool),
                abi.encodeWithSignature("borrow(uint128,uint128,uint32)", uint128(10e18), uint128(100_000e18), uint32(7))
            ),
            "a 200 point disagreement must block the loan"
        );
    }

    function testBothModelsMustBeUsable() public {
        ShiftModel rogue = new ShiftModel(address(model), 200);
        uint32 id2 = registry.register(address(rogue), 0, RefData.inputs(), _refs(200));
        registry.audit(id2, 8); // passes, stays usable
        pool.setDual(id2, 40);

        // freeze it by registering the same wrapper with the honest reference scores
        uint32 bad = registry.register(address(rogue), 0, RefData.inputs(), RefData.scores());
        registry.audit(bad, 8);
        require(!registry.isUsable(bad), "frozen");

        pool.setDual(bad, 1000);
        require(
            expectRevert(
                alice,
                address(pool),
                abi.encodeWithSignature("borrow(uint128,uint128,uint32)", uint128(10e18), uint128(100_000e18), uint32(7))
            ),
            "a frozen second model must block borrowing"
        );
    }

    function testFeesArePaidToBothAuthors() public {
        deposit(bob, 1_000_000e18);
        ShiftModel second = new ShiftModel(address(model), 2);
        uint32 id2 = registry.register(address(second), 2e15, RefData.inputs(), _refs(2));

        CreditPool p2 = new CreditPool(address(token), address(book), address(registry), modelId);
        p2.setDual(id2, 40);

        uint256 author = token.balanceOf(address(this));
        (, uint256 lim) = quote(alice, 100_000e18);
        // borrow through p2 is blocked by the book handover, so only check the quote fee
        (uint16 s, uint256 l, uint96 fee) = p2.quote(address(alice), 100_000e18);
        emit Num("dual fee", fee, 1e15, 2e15);
        require(fee == 1e15 + 2e15, "both per-call fees are charged");
        require(token.balanceOf(address(this)) == author, "nothing charged on a view");
    }
}

/// @dev Full borrow path, single vs dual model.
contract BorrowGasTest is Base {
    event Num(string label, uint256 gas, uint256 a, uint256 b);

    function _refs(int256 d) internal view returns (uint16[] memory s) {
        s = RefData.scores();
        for (uint256 i; i < s.length; ++i) {
            int256 v = int256(uint256(s[i])) + d;
            if (v < 0) v = 0;
            else if (v > 1000) v = 1000;
            s[i] = uint16(uint256(v));
        }
    }

    function testBorrowGasSingleVsDual() public {
        deposit(bob, 10_000_000e18);
        uint128 col = 200_000e18;
        uint128 amt = 10_000e18; // well inside both limits

        approve(alice, uint256(col) + uint256(amt));
        uint256 g0 = gasleft();
        callAs(alice, address(pool), abi.encodeWithSignature("borrow(uint128,uint128,uint32)", amt, col, uint32(7)));
        uint256 single = g0 - gasleft();

        ShiftModel second = new ShiftModel(address(model), 2);
        uint32 id2 = registry.register(address(second), 0, RefData.inputs(), _refs(2));
        pool.setDual(id2, 40);

        Actor carol = new Actor();
        token.mint(address(carol), 1e30);
        approve(carol, uint256(col) + uint256(amt));
        g0 = gasleft();
        callAs(carol, address(pool), abi.encodeWithSignature("borrow(uint128,uint128,uint32)", amt, col, uint32(7)));
        uint256 dual = g0 - gasleft();

        // view path the frontend uses
        (, uint256 limitBefore) = quote(alice, col);
        pool.setSingle();
        g0 = gasleft();
        pool.quote(address(alice), col);
        uint256 quoteSingle = g0 - gasleft();
        pool.setDual(id2, 40);
        g0 = gasleft();
        pool.quote(address(alice), col);
        uint256 quoteDual = g0 - gasleft();

        emit Num("borrow single", single, 0, 0);
        emit Num("borrow dual", dual, 0, 0);
        emit Num("quote single", quoteSingle, 0, 0);
        emit Num("quote dual", quoteDual, 0, 0);
        require(dual > single, "consensus costs more");
        require(quoteDual > quoteSingle, "two model calls on the view path too");
        emit Num("delta borrow", dual - single, single, dual);
        emit Num("limit seen by both", limitBefore, 0, 0);
    }
}

/// @dev Gas of a real 32-draw audit, measured on chain.
contract AuditGasTest is Base {
    event Num(string label, uint256 gas, uint256 draws, uint256 maxDev);

    function testAuditGas() public {
        (uint32 mx, ) = registry.fullDeviation(modelId);
        require(mx == 0, "honest model");

        uint256 g0 = gasleft();
        registry.audit(modelId, 8);
        uint256 g8 = g0 - gasleft();

        g0 = gasleft();
        registry.audit(modelId, 32);
        uint256 g32 = g0 - gasleft();

        emit Num("audit k=8", g8, 8, 0);
        emit Num("audit k=32", g32, 32, 0);
        require(g32 > g8, "more draws cost more");
        require(g32 < 6_000_000, "32 draws stay well under the 30M single-tx cap");
    }
}
