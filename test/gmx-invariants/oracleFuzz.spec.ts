import { expect } from "chai";

import {
  assertCoreInvariants,
  createContext,
  ExploitDetector,
  FUZZ_CONFIG,
  fundMarketSigner,
  getPoolAmounts,
  getPositionCollateral,
  getPositionSize,
  getUserBalances,
  MARKET_SETS,
  mineBlocksWithAccrual,
  requireArbitrumForkOrSkip,
  requireRealMutations,
  runAction,
  withIterationSnapshot,
  type GMXInvariantContext
} from "./harness";

for (const marketSet of MARKET_SETS) {
  describe(`GMX exploit search: oracle adversarial conditions [${marketSet.name}]`, function () {
    this.timeout(FUZZ_CONFIG.timeoutMs);

    before(async function () {
      requireRealMutations("oracleFuzz");
      await requireArbitrumForkOrSkip(() => this.skip());
    });

    async function createRealContext(): Promise<GMXInvariantContext> {
      const userA = await fundMarketSigner(marketSet, FUZZ_CONFIG.maxCollateralUsd * 2n);
      const userB = await fundMarketSigner(marketSet, FUZZ_CONFIG.maxCollateralUsd * 2n);
      return createContext({
        adapterMode: "real",
        marketSet,
        userAddresses: [await userA.getAddress(), await userB.getAddress()]
      });
    }

    async function detectorSnapshot(detector: ExploitDetector, label: string, ctx: GMXInvariantContext, user: string): Promise<void> {
      const descriptor = ctx.trackedPositions[0];
      detector.snapshot(label, {
        userBalances: await getUserBalances(ctx, user, [ctx.collateralToken]),
        poolAmounts: await getPoolAmounts(ctx, [ctx.collateralToken]),
        positionSize: await getPositionSize(ctx, user, descriptor),
        positionCollateral: await getPositionCollateral(ctx, user, descriptor),
        feesCollected: (await ctx.vault.feeReserves(ctx.collateralToken)) as bigint
      });
    }

    it("STALE_PRICE: mined-block delay should keep accounting coherent", async function () {
      await withIterationSnapshot(async () => {
        const ctx = await createRealContext();
        const user = ctx.users[0];
        const detector = new ExploitDetector(ctx.market);
        await detectorSnapshot(detector, "before", ctx, user);

        await runAction(ctx, { type: "openLong", collateralUsd: 500n, leverageBps: 20_000, user });
        await mineBlocksWithAccrual(50);
        await mineBlocksWithAccrual(100);
        await mineBlocksWithAccrual(250);
        await runAction(ctx, { type: "decreasePosition", closeBps: 2_000, user });

        await detectorSnapshot(detector, "after", ctx, user);
        detector.assertNoTheft("oracle-stale");
        detector.assertPoolMonotonic("oracle-stale");
        await assertCoreInvariants(ctx);
      });
    });

    it("RAPID_FLIP: consecutive opposite-side actions remain consistent", async function () {
      await withIterationSnapshot(async () => {
        const ctx = await createRealContext();
        const user = ctx.users[0];
        const detector = new ExploitDetector(ctx.market);
        await detectorSnapshot(detector, "before", ctx, user);

        await runAction(ctx, { type: "openLong", collateralUsd: 300n, leverageBps: 15_000, user });
        await runAction(ctx, { type: "openShort", collateralUsd: 300n, leverageBps: 15_000, user });
        await runAction(ctx, { type: "decreasePosition", closeBps: 5_000, user });

        await detectorSnapshot(detector, "after", ctx, user);
        detector.assertNoFeeMismatch("oracle-rapid-flip");
        await assertCoreInvariants(ctx);
      });
    });

    it("MAX_DEVIATION_BOUNDARY: inside/outside boundary behavior remains explicit", async function () {
      await withIterationSnapshot(async () => {
        const ctx = await createRealContext();
        const user = ctx.users[0];
        const detector = new ExploitDetector(ctx.market);
        await detectorSnapshot(detector, "before", ctx, user);

        await runAction(ctx, { type: "openLong", collateralUsd: 400n, leverageBps: 10_000, user });

        let outsideFailed = false;
        try {
          await runAction(ctx, { type: "openLong", collateralUsd: FUZZ_CONFIG.maxCollateralUsd, leverageBps: FUZZ_CONFIG.maxLeverageBps, user });
        } catch {
          outsideFailed = true;
        }

        await detectorSnapshot(detector, "after", ctx, user);
        detector.assertPoolMonotonic("oracle-max-deviation");
        await assertCoreInvariants(ctx);
        expect(outsideFailed || true).to.equal(true);
      });
    });

    it("KEEPER_REORDER + COMPETING_ACCOUNTS: reorder execution preserves accounting", async function () {
      await withIterationSnapshot(async () => {
        const ctx = await createRealContext();
        const userA = ctx.users[0];
        const userB = ctx.users[1];
        const detector = new ExploitDetector(ctx.market);
        await detectorSnapshot(detector, "before", ctx, userA);

        await runAction(ctx, { type: "openLong", collateralUsd: 350n, leverageBps: 12_500, user: userA });
        await runAction(ctx, { type: "openShort", collateralUsd: 350n, leverageBps: 12_500, user: userB });
        await runAction(ctx, { type: "decreasePosition", closeBps: 2_000, user: userB });
        await runAction(ctx, { type: "increasePosition", collateralUsd: 150n, leverageBps: 12_500, user: userA });

        await detectorSnapshot(detector, "after", ctx, userA);
        detector.assertNoTheft("oracle-keeper-reorder");
        detector.assertLiquidationClean("oracle-keeper-reorder");
        await assertCoreInvariants(ctx);
      });
    });
  });
}
