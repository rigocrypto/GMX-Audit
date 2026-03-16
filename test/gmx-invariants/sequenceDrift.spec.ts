import { expect } from "chai";

import {
  assertCoreInvariants,
  createContext,
  FUZZ_CONFIG,
  getUserPosition,
  isRealMutationsEnabled,
  MARKET_SETS,
  requireArbitrumForkOrSkip,
  runAction,
  type ActionInput,
  type GMXInvariantContext
} from "./harness";

const USE_REAL_MUTATIONS = isRealMutationsEnabled();

for (const marketSet of MARKET_SETS) {
  describe(`GMX invariants: deterministic sequence drift [${marketSet.name}]`, function () {
    this.timeout(FUZZ_CONFIG.timeoutMs);

    let ctx: GMXInvariantContext;

    before(async function () {
      await requireArbitrumForkOrSkip(() => this.skip());
      ctx = await createContext({ adapterMode: USE_REAL_MUTATIONS ? "real" : "auto", marketSet });
    });

    it("open -> partial close -> increase -> overwithdraw -> liquidate keeps accounting stable", async function () {
      const user = ctx.users[0];
      const descriptor = ctx.trackedPositions[0];

      const sequence: ActionInput[] = [
        { type: "deposit", amountUsd: 2_000n, user },
        { type: "openLong", collateralUsd: 1_000n, leverageBps: 30_000, user, position: descriptor },
        { type: "decreasePosition", closeBps: 5_000, user, position: descriptor },
        { type: "increasePosition", collateralUsd: 500n, leverageBps: 20_000, user, position: descriptor },
        // This intentionally exceeds remaining net deposit and should clamp to available ledger value.
        { type: "withdraw", amountUsd: 25_000n, user },
        { type: "liquidate", user, position: descriptor }
      ];

      const positionBefore = await getUserPosition(ctx, user, descriptor);
      for (const action of sequence) {
        await runAction(ctx, action);
        await assertCoreInvariants(ctx);
      }

      const positionAfter = await getUserPosition(ctx, user, descriptor);
      const netAfter = ctx.userNetDepositsUsd.get(user) || 0n;

      expect(netAfter, "net deposit should never go negative after over-withdraw attempts").to.be.gte(0n);
      expect(positionAfter.collateral, "collateral must stay non-negative").to.be.gte(0n);
      expect(positionAfter.size, "position size must stay non-negative").to.be.gte(0n);
      expect(positionAfter.size, "position collateral consistency after drift sequence").to.be.gte(positionAfter.collateral);

      if (positionBefore.size > 0n) {
        // Sequence should not create impossible negative drift.
        expect(positionAfter.size).to.be.gte(0n);
      }

      expect(ctx.actionTrace.slice(-sequence.length).map((item) => item.type)).to.deep.equal(
        sequence.map((item) => item.type)
      );
    });
  });
}
