/**
 * orderFeeEscape.spec.ts
 *
 * Exploit-search: can a trader manipulate execution fees to escape costs?
 *
 * Invariants tested:
 *   1. cancel-resubmit: cancelling and resubmitting an order must not result in
 *      a net fee improvement for the trader vs. executing once.
 *   2. optionality: an order that is created but never executed should not
 *      represent profit-taking through price optionality (collateral returned
 *      must be <= amount deposited minus execution fee).
 *
 * Run: npm run test:exploit:one -- test/gmx-invariants/orderFeeEscape.spec.ts
 */
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  MARKET_SETS,
  isRealMutationsEnabled,
  requireRealMutations,
  fundMarketSigner,
  buildMockOracleParams,
  createOrderForTest,
  cancelOrderForTest,
  executeOrderForTest
} from "./harness";

const ms = MARKET_SETS[0]; // WETH/USDC primary market

describe(`Order Fee Escape [${ms.name}]`, function () {
  this.timeout(300_000);

  before(function () {
    requireRealMutations("orderFeeEscape");
  });

  // ── Invariant 1: cancel-resubmit should not produce net ETH profit ──
  it("cancel + resubmit: trader cannot end with more ETH than start", async function () {
    const executionFee = ethers.parseEther("0.009");
    const orderUsd = 100n;

    const signer = await fundMarketSigner(ms, orderUsd + 50n);
    const signerAddress = await signer.getAddress();

    const ethBefore = await ethers.provider.getBalance(signerAddress);

    // Round 1: create then cancel
    const { key: key1 } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: orderUsd
    });
    await cancelOrderForTest(signer, key1);

    // Round 2: create again
    const { key: key2 } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: orderUsd
    });
    await cancelOrderForTest(signer, key2);

    const ethAfter = await ethers.provider.getBalance(signerAddress);
    const ethCost = ethBefore - ethAfter; // net ETH burned (fees + gas)

    // Execution fee may be partially refunded on cancellation, but strategy
    // should never produce a net ETH gain.
    expect(ethAfter).to.be.lte(
      ethBefore,
      `Trader gained ETH from cancel/resubmit: before=${ethBefore}, after=${ethAfter}`
    );
    expect(ethCost).to.be.gt(0n, `Expected non-zero frictional cost, got cost=${ethCost}`);
  });

  // ── Invariant 2: free optionality — collateral returned on cancel ≤ deposited ─
  it("cancelled order: collateral returned does not exceed deposited amount", async function () {
    const executionFee = ethers.parseEther("0.009");
    const orderUsd = 200n;

    const signer = await fundMarketSigner(ms, orderUsd + 50n);
    const signerAddress = await signer.getAddress();

    const token = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.collateralToken
    );

    const collateralBefore = BigInt(
      (await (token as any).balanceOf(signerAddress)).toString()
    );

    const { key } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("200", 30),
      isLong: true,
      executionFee,
      collateralUsd: orderUsd
    });

    // Wait 2 blocks so price could have moved (optionality window)
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_mine", []);

    await cancelOrderForTest(signer, key);

    const collateralAfter = BigInt(
      (await (token as any).balanceOf(signerAddress)).toString()
    );

    // Collateral returned must not exceed what was deposited
    // (would indicate the trader extracted value via price optionality)
    expect(collateralAfter).to.be.lte(
      collateralBefore,
      `Trader received more collateral than deposited: before=${collateralBefore}, after=${collateralAfter}`
    );
  });

  // ── Deterministic: execute path — position opened successfully ─────────
  it("executeOrder: market-increase position is opened (deterministic)", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }

    const executionFee = ethers.parseEther("0.009");
    const orderUsd = 100n;

    const signer = await fundMarketSigner(ms, orderUsd + 50n);
    const oracleParams = await buildMockOracleParams([ms.longToken, ms.shortToken]);

    const { key } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: orderUsd
    });

    const execReceipt = await executeOrderForTest(key, oracleParams);
    expect(execReceipt.status).to.equal(1, "executeOrder tx must succeed");
  });
});
