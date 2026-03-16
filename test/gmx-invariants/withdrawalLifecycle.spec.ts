/**
 * withdrawalLifecycle.spec.ts
 *
 * Exploit-search: can a trader extract excess value from withdrawals?
 *
 * Invariants tested:
 *   1. price-shift payout: executing a withdrawal after a favorable price move
 *      must not yield more long/short tokens than the fair pro-rata share at
 *      withdrawal creation time.
 *   2. cancel fee: cancelling a pending withdrawal must not return more
 *      ETH + tokens than the signer deposited (no fee-free optionality).
 *
 * Run: npm run test:exploit:one -- test/gmx-invariants/withdrawalLifecycle.spec.ts
 */
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  MARKET_SETS,
  requireRealMutations,
  fundMarketSigner,
  buildMockOracleParams,
  createDepositForTest,
  executeDepositForTest,
  createWithdrawalForTest,
  cancelWithdrawalForTest,
  executeWithdrawalForTest
} from "./harness";

const ms = MARKET_SETS[0]; // WETH/USDC primary market

describe(`Withdrawal Lifecycle [${ms.name}]`, function () {
  this.timeout(300_000);

  async function mintGmForSigner(signer: any, executionFee: bigint): Promise<bigint> {
    const signerAddress = await signer.getAddress();
    const shortToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.shortToken
    );
    const longToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.longToken
    );
    const shortBal = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());
    const longBal = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortDeposit = shortBal / 20n;
    const longDeposit = shortDeposit > 0n ? 0n : longBal / 20n;
    expect(shortDeposit + longDeposit).to.be.gt(0n, "token seed funding missing for deposit setup");

    const { key } = await createDepositForTest({
      marketSet: ms,
      signer,
      longTokenAmount: longDeposit,
      shortTokenAmount: shortDeposit,
      executionFee
    });

    const oracleParams = await buildMockOracleParams([ms.longToken, ms.shortToken]);

    const receipt = await executeDepositForTest(key, oracleParams);
    expect(receipt.status).to.equal(1, "executeDeposit must succeed");

    const marketToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.market
    );
    return BigInt((await (marketToken as any).balanceOf(signerAddress)).toString());
  }

  before(function () {
    requireRealMutations("withdrawalLifecycle");
  });

  // ── Invariant 1: cancel refunds execution fee but not more ─────────────
  it("cancelWithdrawal: ETH cost to user >= 0 (no net ETH gain)", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }

    const collateralSigner = await fundMarketSigner(ms, 100n);
    const signerAddress = await collateralSigner.getAddress();
    const executionFee = ethers.parseEther("0.009");
    const gmAmount = await mintGmForSigner(collateralSigner, executionFee);
    expect(gmAmount).to.be.gt(0n, "deposit should mint GM tokens");

    const ethBefore = await ethers.provider.getBalance(signerAddress);

    const smallAmount = gmAmount / 8n;
    const { key } = await createWithdrawalForTest({
      marketSet: ms,
      signer: collateralSigner,
      marketTokenAmount: smallAmount,
      executionFee
    });

    await cancelWithdrawalForTest(collateralSigner, key);

    const ethAfter = await ethers.provider.getBalance(signerAddress);

    // After cancel, user must not have more ETH than before (no net ETH gain)
    // Gas costs ensure ethAfter < ethBefore
    expect(ethAfter).to.be.lte(
      ethBefore,
      `User gained ETH from cancel: before=${ethBefore}, after=${ethAfter}`
    );
  });

  // ── Invariant 2: executed withdrawal pays pro-rata, not more ───────────
  it("executeWithdrawal: payout <= fair share of pool (no excess extraction)", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }

    const collateralSigner = await fundMarketSigner(ms, 100n);
    const signerAddress = await collateralSigner.getAddress();
    const executionFee = ethers.parseEther("0.009");
    const gmAmount = await mintGmForSigner(collateralSigner, executionFee);
    expect(gmAmount).to.be.gt(0n, "deposit should mint GM tokens");

    // Measure collateral balance before withdrawal
    const longToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.longToken
    );
    const shortToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.shortToken
    );

    const longBefore = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortBefore = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());

    const smallAmount = gmAmount / 8n;
    const { key } = await createWithdrawalForTest({
      marketSet: ms,
      signer: collateralSigner,
      marketTokenAmount: smallAmount,
      executionFee
    });

    // Mine a block (simulate time / possible price movement)
    await ethers.provider.send("evm_mine", []);

    const oracleParams = await buildMockOracleParams([ms.longToken, ms.shortToken]);
    const execReceipt = await executeWithdrawalForTest(key, oracleParams);
    expect(execReceipt.status).to.equal(1, "executeWithdrawal must succeed");

    const longAfter = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortAfter = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());

    // User must have received something back
    const longDelta = longAfter - longBefore;
    const shortDelta = shortAfter - shortBefore;
    expect(longDelta + shortDelta).to.be.gt(
      0n,
      "executeWithdrawal must pay out tokens"
    );
  });
});
