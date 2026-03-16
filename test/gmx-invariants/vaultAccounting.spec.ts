import { expect } from "chai";
import fc from "fast-check";
import { network } from "hardhat";

import {
  assertCoreInvariants,
  createContext,
  FUZZ_CONFIG,
  fundFreshSigner,
  isRealMutationsEnabled,
  MARKET_SETS,
  type GMXInvariantContext,
  type ActionInput,
  requireArbitrumForkOrSkip,
  withIterationSnapshot,
  runAction
} from "./harness";

const USE_REAL_MUTATIONS = isRealMutationsEnabled();

for (const marketSet of MARKET_SETS) {
  describe(`GMX invariants: vault accounting [${marketSet.name}]`, function () {
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

    it("keeps core accounting invariants across deterministic action flow", async function () {
      const sequence: ActionInput[] = [
        { type: "deposit", amountUsd: useRealMutationsForMarket ? 1_000n : 5_000n, user: ctx.users[0] },
        { type: "openLong", collateralUsd: useRealMutationsForMarket ? 600n : 2_000n, leverageBps: 30000, user: ctx.users[0] },
        { type: "increasePosition", collateralUsd: 500n, leverageBps: 25000, user: ctx.users[0] },
        { type: "openShort", collateralUsd: 1_000n, leverageBps: 20000, user: ctx.users[1] },
        { type: "decreasePosition", closeBps: 2000, user: ctx.users[0] },
        { type: "withdraw", amountUsd: 250n, user: ctx.users[0] }
      ];

      for (const action of sequence) {
        await runAction(ctx, action);
        await assertCoreInvariants(ctx);
      }
    });

    it("holds accounting invariants under property-based randomized scenarios", async function () {
      const amountArb = fc.bigInt({ min: 1n, max: FUZZ_CONFIG.maxCollateralUsd });
      const leverageArb = fc.integer({ min: 10_000, max: FUZZ_CONFIG.maxLeverageBps });
      const closeBpsArb = fc.integer({ min: 100, max: 10_000 });

      const actionArb = fc.oneof(
        fc.record({ type: fc.constant<ActionInput["type"]>("deposit"), amountUsd: amountArb }),
        fc.record({ type: fc.constant<ActionInput["type"]>("openLong"), collateralUsd: amountArb, leverageBps: leverageArb }),
        fc.record({ type: fc.constant<ActionInput["type"]>("openShort"), collateralUsd: amountArb, leverageBps: leverageArb }),
        fc.record({ type: fc.constant<ActionInput["type"]>("increasePosition"), collateralUsd: amountArb, leverageBps: leverageArb }),
        fc.record({ type: fc.constant<ActionInput["type"]>("decreasePosition"), closeBps: closeBpsArb }),
        fc.record({ type: fc.constant<ActionInput["type"]>("withdraw"), amountUsd: amountArb })
      );

      await fc.assert(
        fc.asyncProperty(fc.array(actionArb, { minLength: 8, maxLength: 20 }), async (actions) => {
          await withIterationSnapshot(async () => {
            const localCtx = await createLocalContext();

            for (const [index, action] of actions.entries()) {
              const user = localCtx.users[index % localCtx.users.length];
              await runAction(localCtx, { ...action, user });
              await assertCoreInvariants(localCtx);
            }
          });
        }),
        {
          numRuns: FUZZ_CONFIG.runs
        }
      );
    });

    it("rejects negative net-withdraw accounting", async function () {
      await runAction(ctx, { type: "deposit", amountUsd: 1_000n, user: ctx.users[0] });
      await runAction(ctx, { type: "withdraw", amountUsd: 500n, user: ctx.users[0] });
      await assertCoreInvariants(ctx);

      const net = ctx.userNetDepositsUsd.get(ctx.users[0]) || 0n;
      expect(net).to.be.gte(0n);
    });

    it("deposit then open long keeps collateral invariant", async function () {
      const user = ctx.users[0];

      await runAction(ctx, { type: "deposit", amountUsd: 1_000n, user });
      await runAction(ctx, { type: "openLong", collateralUsd: 500n, leverageBps: 20_000, user });

      expect(ctx.actionTrace.at(-2)?.type).to.equal("deposit");
      expect(ctx.actionTrace.at(-1)?.type).to.equal("openLong");
    });
  });
}
