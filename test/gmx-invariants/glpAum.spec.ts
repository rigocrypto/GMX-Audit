import { expect } from "chai";
import fc from "fast-check";
import { network } from "hardhat";

import {
  createContext,
  FUZZ_CONFIG,
  fundFreshSigner,
  getPoolState,
  isRealMutationsEnabled,
  MARKET_SETS,
  requireArbitrumForkOrSkip,
  runAction,
  assertCoreInvariants,
  withIterationSnapshot,
  type GMXInvariantContext
} from "./harness";

const USE_REAL_MUTATIONS = isRealMutationsEnabled();

for (const marketSet of MARKET_SETS) {
  describe(`GMX invariants: GLP/AUM and exchange accounting [${marketSet.name}]`, function () {
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

    function estimateAumUsd(poolState: Awaited<ReturnType<typeof getPoolState>>): { minAum: bigint; maxAum: bigint } {
      let minAum = 0n;
      let maxAum = 0n;

      for (const token of poolState.tokens) {
        const scale = 10n ** BigInt(token.decimals);
        minAum += (token.poolAmount * token.minPrice) / scale;
        maxAum += (token.poolAmount * token.maxPrice) / scale;
      }

      return { minAum, maxAum };
    }

    it("keeps AUM valuation within bounded min/max band", async function () {
      const state = await getPoolState(ctx);
      const { minAum, maxAum } = estimateAumUsd(state);

      expect(maxAum).to.be.gte(minAum);

      // A 1.5% valuation movement guardrail for price-band consistency checks.
      if (minAum > 0n) {
        const driftBps = Number(((maxAum - minAum) * 10_000n) / minAum);
        expect(driftBps).to.be.lte(1_500);
      }

      await assertCoreInvariants(ctx);
    });

    it("preserves exchange router vs vault accounting invariants through action transitions", async function () {
      const actions = [
        { type: "deposit", amountUsd: useRealMutationsForMarket ? 1_000n : 5_000n },
        { type: "openLong", collateralUsd: useRealMutationsForMarket ? 400n : 1_000n, leverageBps: 30_000 },
        { type: "openShort", collateralUsd: useRealMutationsForMarket ? 400n : 1_250n, leverageBps: 25_000 },
        { type: "increasePosition", collateralUsd: 500n, leverageBps: 20_000 },
        { type: "decreasePosition", closeBps: 1_500 },
        { type: "withdraw", amountUsd: 250n }
      ] as const;

      for (const [index, action] of actions.entries()) {
        await runAction(ctx, { ...action, user: ctx.users[index % ctx.users.length] });
        await assertCoreInvariants(ctx);
      }
    });

    it("keeps GLP/AUM consistency across randomized action traces", async function () {
      const actionArb = fc.oneof(
        fc.record({ type: fc.constant("deposit" as const), amountUsd: fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxCollateralUsd }) }),
        fc.record({ type: fc.constant("openLong" as const), collateralUsd: fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxCollateralUsd }), leverageBps: fc.integer({ min: 10_000, max: FUZZ_CONFIG.maxLeverageBps }) }),
        fc.record({ type: fc.constant("openShort" as const), collateralUsd: fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxCollateralUsd }), leverageBps: fc.integer({ min: 10_000, max: FUZZ_CONFIG.maxLeverageBps }) }),
        fc.record({ type: fc.constant("increasePosition" as const), collateralUsd: fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxIncreaseCollateralUsd }), leverageBps: fc.integer({ min: 10_000, max: FUZZ_CONFIG.maxLeverageBps }) }),
        fc.record({ type: fc.constant("decreasePosition" as const), closeBps: fc.integer({ min: 100, max: 5_000 }) }),
        fc.record({ type: fc.constant("withdraw" as const), amountUsd: fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxWithdrawUsd }) })
      );

      await fc.assert(
        fc.asyncProperty(fc.array(actionArb, { minLength: 6, maxLength: 15 }), async (actions) => {
          await withIterationSnapshot(async () => {
            const local = await createLocalContext();

            for (const [index, action] of actions.entries()) {
              await runAction(local, { ...action, user: local.users[index % local.users.length] });
              await assertCoreInvariants(local);

              const state = await getPoolState(local);
              const { minAum, maxAum } = estimateAumUsd(state);
              expect(maxAum).to.be.gte(minAum);
            }
          });
        }),
        {
          numRuns: FUZZ_CONFIG.runs
        }
      );
    });
  });
}
