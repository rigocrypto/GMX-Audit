/**
 * helperSmoke.spec.ts
 *
 * Validates that the lifecycle helpers (createOrderForTest, cancelOrderForTest,
 * createWithdrawalForTest, cancelWithdrawalForTest, executeOrderForTest,
 * executeWithdrawalForTest) operate correctly end-to-end on the fork.
 *
 * Run: npm run test:exploit:one -- test/gmx-invariants/helperSmoke.spec.ts
 * Expected: up to 4 passing (3 without oracle / GM tokens, 4 with full setup).
 */
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  MARKET_SETS,
  isRealMutationsEnabled,
  fundMarketSigner,
  buildMockOracleParams,
  createDepositForTest,
  executeDepositForTest,
  createOrderForTest,
  cancelOrderForTest,
  executeOrderForTest,
  createWithdrawalForTest,
  cancelWithdrawalForTest,
  executeWithdrawalForTest
} from "./harness";

const ms = MARKET_SETS[0]; // WETH/USDC only

describe(`Lifecycle Helpers Smoke [${ms.name}]`, function () {
  this.timeout(180_000);

  let signer: any;

  before(async function () {
    if (!isRealMutationsEnabled()) {
      return this.skip();
    }
    // fundMarketSigner creates a fresh impersonated wallet with $600 of collateral
    signer = await fundMarketSigner(ms, 600n);
  });

  // ── Order: create → cancel ─────────────────────────────────────────────
  it("createOrderForTest: returns valid bytes32 key", async function () {
    const executionFee = ethers.parseEther("0.009");
    const { key } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: 100n
    });
    expect(key).to.match(/^0x[0-9a-fA-F]{64}$/);
  });

  it("cancelOrderForTest: cancels a live order without revert", async function () {
    const executionFee = ethers.parseEther("0.009");
    const { key } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: 100n
    });
    const cancelReceipt = await cancelOrderForTest(signer, key);
    expect(cancelReceipt.status).to.equal(1);
  });

  // ── Order: create → executeOrder with mock oracle ──────────────────────
  it("executeOrderForTest: keeper executes a market-increase order", async function () {
    const executionFee = ethers.parseEther("0.009");
    const tokens = [ms.longToken, ms.shortToken];
    const oracleParams = await buildMockOracleParams(tokens);

    const { key } = await createOrderForTest({
      marketSet: ms,
      signer,
      sizeDeltaUsd: ethers.parseUnits("100", 30),
      isLong: true,
      executionFee,
      collateralUsd: 100n
    });

    const execReceipt = await executeOrderForTest(key, oracleParams);
    expect(execReceipt.status).to.equal(1);
  });

  // ── Withdrawal: create → cancel ────────────────────────────────────────
  it("createWithdrawalForTest: returns valid bytes32 key", async function () {
    const signerAddress = await signer.getAddress();
    const shortToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.shortToken
    );
    const shortBal = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());
    const shortDeposit = shortBal / 20n;
    const longToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.longToken
    );
    const longBal = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const longDeposit = shortDeposit > 0n ? 0n : longBal / 20n;
    expect(shortDeposit + longDeposit).to.be.gt(0n, "token seed funding missing for deposit setup");

    const executionFee = ethers.parseEther("0.009");
    const { key: depositKey } = await createDepositForTest({
      marketSet: ms,
      signer,
      longTokenAmount: longDeposit,
      shortTokenAmount: shortDeposit,
      executionFee
    });
    const oracleParams = await buildMockOracleParams([ms.longToken, ms.shortToken]);
    const depositReceipt = await executeDepositForTest(depositKey, oracleParams);
    expect(depositReceipt.status).to.equal(1);

    const marketToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.market
    );
    const gmBalance = BigInt((await (marketToken as any).balanceOf(signerAddress)).toString());
    expect(gmBalance).to.be.gt(0n, "deposit should mint GM tokens");

    const smallAmount = gmBalance / 8n;
    const { key } = await createWithdrawalForTest({
      marketSet: ms,
      signer,
      marketTokenAmount: smallAmount,
      executionFee
    });
    expect(key).to.match(/^0x[0-9a-fA-F]{64}$/);

    // Cancel to recover the GM tokens for subsequent tests
    const cancelReceipt = await cancelWithdrawalForTest(signer, key);
    expect(cancelReceipt.status).to.equal(1);
  });
});
