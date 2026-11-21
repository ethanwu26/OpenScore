// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ScoreCard} from "../src/ScoreCard.sol";
import {ScoreCardAlt} from "../src/ScoreCardAlt.sol";
import {RiskModel} from "../src/RiskModel.sol";
import {ModelRegistry} from "../src/ModelRegistry.sol";
import {BehaviorBook} from "../src/BehaviorBook.sol";
import {CreditPool} from "../src/CreditPool.sol";
import {MockTUSD} from "../src/MockTUSD.sol";
import {AgentCard} from "../src/AgentCard.sol";
import {CreditShop} from "../src/CreditShop.sol";
import {OpenScoreLens} from "../src/OpenScoreLens.sol";
import {DecoyPool} from "../src/DecoyPool.sol";
import {Bench} from "../src/Bench.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}

/// @dev The card loop end to end: issue, swipe, repay, default. No forge-std needed.
contract CardTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockTUSD token;
    ModelRegistry registry;
    ScoreCard cardModel;
    ScoreCardAlt altModel;
    RiskModel neural;
    BehaviorBook book;
    CreditPool pool;
    AgentCard card;
    CreditShop shop;
    OpenScoreLens lens;
    DecoyPool lab;

    address owner = address(0xA11CE);
    address agent = address(0xA6E47);
    address merchant = address(0x5407);
    address stranger = address(0xBAD);

    uint128 constant COL = 100_000e18;
    uint256 constant PRICE = 10_000e18;

    function refs() internal pure returns (int256[10][] memory ins, uint16[] memory out) {
        ins = new int256[10][](8);
        ins[0] = [int256(1420), 6000, 0, 0, 980, 180, 0, 950, -40, 260];
        ins[1] = [int256(12), 300, 4, 3, 120, 900, 4, 0, 420, 1150];
        ins[2] = [int256(0), 1000, 0, 0, 0, 0, 0, 0, 0, 0];
        ins[3] = [int256(0), 1000, 0, 0, 1000, 500, 0, 1000, 0, 500];
        ins[4] = [int256(365), 1000, 0, 0, 1000, 500, 0, 1000, 0, 500];
        ins[5] = [int256(0), 1000, 1, 1, 1000, 500, 0, 1000, 0, 500];
        ins[6] = [int256(0), 1000, 1, 1, 500, 1000, 1, 0, 300, 1000];
        ins[7] = [int256(870), 2500, 0, 0, 48, 284, 0, 42, 62, 284];
        out = new uint16[](8);
        out[0] = 1000;
        out[1] = 186;
        out[2] = 288;
        out[3] = 755;
        out[4] = 905;
        out[5] = 618;
        out[6] = 440;
        out[7] = 947;
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockTUSD();
        registry = new ModelRegistry();
        cardModel = new ScoreCard();
        altModel = new ScoreCardAlt();
        neural = new RiskModel();
        (int256[10][] memory ins, uint16[] memory out) = refs();
        uint32 id = registry.register(address(cardModel), 1e15, ins, out);
        book = new BehaviorBook();
        pool = new CreditPool(address(token), address(book), address(registry), id);
        book.setPool(address(pool));
        card = new AgentCard(address(token));
        shop = new CreditShop(address(token), address(pool), merchant, COL, PRICE);
        lens = new OpenScoreLens(
            address(token), address(card), address(pool), address(book), address(shop), address(cardModel), address(neural), COL
        );
        BehaviorBook decoyBook = new BehaviorBook();
        lab = new DecoyPool(address(token), address(decoyBook), address(registry), address(altModel));
        decoyBook.setPool(address(lab));

        token.mint(address(this), 5_000_000e18);
        token.approve(address(pool), type(uint256).max);
        pool.deposit(5_000_000e18);

        token.mint(owner, 300_000e18);
        vm.startPrank(owner);
        token.approve(address(card), type(uint256).max);
        card.issue(agent, "squirrel", 300_000e18);
        vm.stopPrank();
        vm.prank(agent);
        token.approve(address(pool), type(uint256).max);
    }

    function eq(uint256 a, uint256 b, string memory what) internal pure {
        require(a == b, what);
    }

    function testSwipeRepayLoop() public {
        (uint16 s0, uint256 l0,) = pool.quote(agent, COL);
        eq(s0, 288, "fresh score");
        eq(l0, 28_800e18, "fresh limit");
        (, uint256 p0) = shop.priceFor(agent);
        eq(p0, PRICE, "full price");

        vm.prank(agent);
        (uint256 id, uint256 price) = pool.swipe(address(shop), COL, 1);
        eq(price, PRICE, "price charged");
        eq(token.balanceOf(merchant), 9_900e18, "merchant gets price minus 1%");
        eq(pool.earned(), 100e18, "interchange stays in the pool");
        eq(token.balanceOf(agent), 200_000e18, "collateral locked, nothing else spent");
        eq(pool.outstanding(), PRICE, "debt booked");
        eq(shop.purchases(), 1, "purchase counted");

        vm.prank(agent);
        pool.repay(id, uint128(PRICE));
        eq(token.balanceOf(agent), 290_000e18, "collateral back, price paid");
        eq(pool.outstanding(), 0, "debt cleared");
        (,,,, bool closed) = pool.loans(id);
        require(closed, "loan closed");

        (uint16 s1, uint256 l1,) = pool.quote(agent, COL);
        eq(s1, 806, "score after one clean cycle");
        eq(l1, 80_600e18, "limit after one clean cycle");
        (, uint256 p1) = shop.priceFor(agent);
        eq(p1, 8_000e18, "discounted price");
    }

    function testDefaultCutsTheLine() public {
        vm.startPrank(agent);
        (uint256 id,) = pool.swipe(address(shop), COL, 1);
        pool.repay(id, uint128(PRICE));
        (uint256 id2, uint256 price2) = pool.swipe(address(shop), COL, 0);
        vm.stopPrank();
        eq(price2, 8_000e18, "second swipe is discounted");

        uint256 liqBefore = pool.liquidity();
        vm.warp(block.timestamp + 1);
        vm.prank(stranger);
        pool.liquidate(id2);
        eq(pool.liquidity(), liqBefore + COL, "seized collateral goes to lenders");
        eq(pool.outstanding(), 0, "written off");

        (uint16 s, uint256 l,) = pool.quote(agent, COL);
        eq(s, 536, "score after default");
        eq(l, 26_800e18, "limit halved after default");
        (, uint256 p) = shop.priceFor(agent);
        eq(p, PRICE, "discount gone");

        vm.prank(agent);
        vm.expectRevert(CreditPool.InCooldown.selector);
        pool.swipe(address(shop), COL, 1);
    }

    function testSwipeOverLimitFails() public {
        // a shop that charges more than a fresh agent's 28,800 line
        CreditShop pricey = new CreditShop(address(token), address(pool), merchant, COL, 30_000e18);
        vm.prank(agent);
        vm.expectRevert(CreditPool.OverLimit.selector);
        pool.swipe(address(pricey), COL, 1);
    }

    function testOnlyPoolCanCheckout() public {
        vm.prank(stranger);
        vm.expectRevert(CreditShop.OnlyPool.selector);
        shop.checkout(agent);
    }

    function testLendersCanOnlyWithdrawTheirOwn() public {
        vm.prank(stranger);
        vm.expectRevert(CreditPool.NoLiquidity.selector);
        pool.withdraw(1e18);
        pool.withdraw(1_000_000e18);
        eq(pool.depositOf(address(this)), 4_000_000e18, "own deposit reduced");
    }

    function testLens() public {
        vm.startPrank(agent);
        pool.swipe(address(shop), COL, 1);
        vm.stopPrank();
        (OpenScoreLens.AgentView[] memory list, OpenScoreLens.PoolView memory p) = lens.board(50);
        eq(list.length, 1, "one card");
        require(list[0].agent == agent && list[0].owner == owner, "binding");
        require(list[0].hasOpenLoan && list[0].debt == PRICE && list[0].locked == COL, "open loan");
        require(list[0].quoteOk && list[0].priceOk, "quote ok");
        eq(p.earned, 100e18, "earned");
        eq(p.agentCount, 1, "count");
        (uint16 sc, uint16[5] memory parts, uint16 nn) =
            lens.trial([int256(0), 1000, 0, 0, 0, 0, 0, 0, 0, 0]);
        eq(sc, 288, "trial score");
        eq(uint256(parts[0]) + parts[1] + parts[2] + parts[3] + parts[4], 288, "parts add up");
        eq(nn, 506, "neural second opinion");
    }

    function testDecoyIsCaughtAndItsPoolStops() public {
        (,, bool usable, bool ok,,) = lab.status(agent, COL);
        require(!usable && !ok, "nothing to lend against before the first round");
        uint32 id = lab.arm();
        uint16 score;
        (,, usable, ok, score,) = lab.status(agent, COL);
        require(usable && ok, "decoy lends before the audit");
        eq(score, 298, "tampered model overscores by 10");
        require(registry.audit(0, 8), "honest model passes");
        require(!registry.audit(id, 4), "decoy fails");
        (,, usable, ok,,) = lab.status(agent, COL);
        require(!usable && !ok, "decoy pool refuses after the freeze");
        vm.expectRevert(CreditPool.NotUsableModel.selector);
        lab.quote(agent, COL);

        uint32 id2 = lab.arm();
        require(id2 != id && lab.round() == 2, "new round");
        (,, usable, ok,,) = lab.status(agent, COL);
        require(usable && ok, "fresh decoy lends again");
        // one sample is enough: every reference input is off
        require(!registry.audit(id2, 1), "caught with a single draw");
    }

    function testBenchMeasuresItself() public {
        Bench b = new Bench();
        b.payDense(10_000, 7);
        b.payScattered(300, 7);
        b.payDense(10_000, 1);
        b.payScattered(300, 1);
        (uint64 n, uint64 g,, uint64 c) = b.lastDense();
        (uint64 n2, uint64 g2,, uint64 c2) = b.lastScattered();
        require(n == 10_000 && n2 == 300 && c == 2 && c2 == 2, "runs recorded");
        require(g > 0 && g2 > 0, "gas recorded");
        eq(b.denseAt(0), 8, "dense balance");
        eq(b.denseAt(9_999), 8, "dense balance tail");
        eq(b.scatteredAt(300), 8, "scattered balance");
    }
}
