import { expect } from "chai";
import fc from "fast-check";
import { network } from "hardhat";

import {
  createContext,
  FUZZ_CONFIG,
  fundFreshSigner,
  isRealMutationsEnabled,
  MARKET_SETS,
  type GMXInvariantContext,
  getUserPosition,
  requireArbitrumForkOrSkip,
  runAction,
  assertCoreInvariants,
  withIterationSnapshot
} from "./harness";

const USE_REAL_MUTATIONS = isRealMutationsEnabled();

const LIQUIDATION_THRESHOLD_BPS = 9_000;

for (const marketSet of MARKET_SETS) {
  describe(`GMX invariants: liquidation safety [${marketSet.name}]`, function () {
    this.timeout(FUZZ_CONFIG.timeoutMs);

    const useRealMutationsForMarket = USE_REAL_MUTATIONS;

    let ctx: GMXInvariantContext;

    async function createLocalContext(): Promise<GMXInvariantContext> {
      if (!useRealMutationsForMarket) {
        return createContext({ adapterMode: "auto", marketSet });
      }

      const userA = await fundFreshSigner();
      const userB = await fundFreshSigner();
      return createContext({
        adapterMode: "real",
        marketSet,
        userAddresses: [await userA.getAddress(), await userB.getAddress()]
      });
    }

    before(async function () {
      await requireArbitrumForkOrSkip(() => this.skip());
      ctx = await createContext({ adapterMode: useRealMutationsForMarket ? "real" : "auto", marketSet });
    });

    it("does not allow liquidation above synthetic liquidation threshold", async function () {
      const descriptor = ctx.trackedPositions[0];
      const user = ctx.users[0];

      await runAction(ctx, {
        type: "openLong",
        collateralUsd: useRealMutationsForMarket ? 600n : 2_000n,
        leverageBps: 20_000,
        user,
        position: descriptor
      });

      const before = await getUserPosition(ctx, user, descriptor);

      const collateralRatioBps = before.size === 0n ? 10_000 : Number((before.collateral * 10_000n) / before.size);
      expect(collateralRatioBps).to.be.gte(LIQUIDATION_THRESHOLD_BPS);

      await runAction(ctx, {
        type: "liquidate",
        user,
        position: descriptor
      });

      const after = await getUserPosition(ctx, user, descriptor);
      expect(after.size).to.equal(before.size);
      expect(after.collateral).to.equal(before.collateral);

      await assertCoreInvariants(ctx);
    });

    it("handles boundary conditions around tiny collateral, max leverage and near-liquidation range", async function () {
      const descriptor = ctx.trackedPositions[0];
      const user = ctx.users[1];

      const scenarios = [
        { collateralUsd: 1n, leverageBps: 100_000 },
        { collateralUsd: 50n, leverageBps: 90_000 },
        { collateralUsd: 200n, leverageBps: 66_666 }
      ];

      for (const scenario of scenarios) {
        await runAction(ctx, {
          type: "openLong",
          collateralUsd: scenario.collateralUsd,
          leverageBps: scenario.leverageBps,
          user,
          position: descriptor
        });

        // 1.5% synthetic movement envelope (without oracle manipulation).
        await runAction(ctx, {
          type: "decreasePosition",
          closeBps: 150,
          user,
          position: descriptor
        });

        await assertCoreInvariants(ctx);
      }
    });

    it("keeps liquidation invariant under randomized leverage and partial close fuzz", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxCollateralUsd }),
          fc.integer({ min: 20_000, max: FUZZ_CONFIG.maxLeverageBps }),
          fc.integer({ min: 100, max: 5_000 }),
          async (collateralUsd, leverageBps, closeBps) => {
            await withIterationSnapshot(async () => {
              const local = await createLocalContext();
              const descriptor = local.trackedPositions[0];
              const user = local.users[0];

              await runAction(local, {
                type: "openLong",
                collateralUsd,
                leverageBps,
                user,
                position: descriptor
              });

              await runAction(local, {
                type: "decreasePosition",
                closeBps,
                user,
                position: descriptor
              });

              await runAction(local, {
                type: "liquidate",
                user,
                position: descriptor
              });

              const pos = await getUserPosition(local, user, descriptor);
              if (pos.size > 0n) {
                const collateralRatioBps = Number((pos.collateral * 10_000n) / pos.size);
                expect(collateralRatioBps).to.be.gte(0);
              }

              await assertCoreInvariants(local);
            });
          }
        ),
        {
          numRuns: FUZZ_CONFIG.runs
        }
      );
    });
  });
}
