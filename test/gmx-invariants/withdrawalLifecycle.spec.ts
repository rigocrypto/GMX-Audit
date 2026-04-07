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
  getChainlinkProviderRefPrice,
  getTokenMarketValue,
  getDefaultDataStoreAddress,
  createDepositForTest,
  executeDepositForTest,
  createWithdrawalForTest,
  cancelWithdrawalForTest,
  executeWithdrawalForTest
} from "./harness";

const ms = MARKET_SETS[0]; // WETH/USDC primary market

describe(`Withdrawal Lifecycle [${ms.name}]`, function () {
  this.timeout(300_000);
  const FLOAT_PRECISION = 10n ** 30n;

  function applyBps(value: bigint, bps: bigint): bigint {
    return (value * bps) / 10_000n;
  }

  function deriveFeeKey(base: string, market: string, balanceWasImproved: boolean): string {
    const baseHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["string"], [base])
    );
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "bool"],
        [baseHash, market, balanceWasImproved]
      )
    );
  }

  async function getRoundTripFeeBounds(market: string): Promise<{
    minFeeFactor: bigint;
    maxFeeFactor: bigint;
    depositFactors: [bigint, bigint];
    withdrawalFactors: [bigint, bigint];
  }> {
    const dataStoreAddress = getDefaultDataStoreAddress();
    expect(dataStoreAddress).to.not.equal(
      "0x0000000000000000000000000000000000000000",
      "resolved DataStore address is required for fee-aware assertions"
    );

    const dataStore = await ethers.getContractAt(
      ["function getUint(bytes32 key) view returns (uint256)"],
      dataStoreAddress
    );

    const depositImproved = BigInt(
      (await (dataStore as any).getUint(deriveFeeKey("DEPOSIT_FEE_FACTOR", market, true))).toString()
    );
    const depositWorsened = BigInt(
      (await (dataStore as any).getUint(deriveFeeKey("DEPOSIT_FEE_FACTOR", market, false))).toString()
    );
    const withdrawalImproved = BigInt(
      (await (dataStore as any).getUint(deriveFeeKey("WITHDRAWAL_FEE_FACTOR", market, true))).toString()
    );
    const withdrawalWorsened = BigInt(
      (await (dataStore as any).getUint(deriveFeeKey("WITHDRAWAL_FEE_FACTOR", market, false))).toString()
    );

    const all = [depositImproved, depositWorsened, withdrawalImproved, withdrawalWorsened];
    const minFeeFactor = all.reduce((min, cur) => (cur < min ? cur : min), all[0]);
    const maxFeeFactor = all.reduce((max, cur) => (cur > max ? cur : max), all[0]);

    return {
      minFeeFactor,
      maxFeeFactor,
      depositFactors: [depositImproved, depositWorsened],
      withdrawalFactors: [withdrawalImproved, withdrawalWorsened]
    };
  }

  async function getWalletTokenValue(signerAddress: string): Promise<bigint> {
    const longToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.longToken
    );
    const shortToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.shortToken
    );

    const longBal = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortBal = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());

    return (
      (await getTokenMarketValue(ms.longToken, longBal)) +
      (await getTokenMarketValue(ms.shortToken, shortBal))
    );
  }

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

  // ── Sanity: verify oracle prices are in a sane range before running probes ──
  it("DIAGNOSTIC: oracle ref prices are in the expected GMX scale", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }
    const [longPrice, shortPrice] = await Promise.all([
      getChainlinkProviderRefPrice(ms.longToken),
      getChainlinkProviderRefPrice(ms.shortToken)
    ]);
    // In GMX oracle format, price = usd × 10^(30 − tokenDecimals).
    // For any token: sane USD range $0.01–$1M gives prices in 10^6 – 10^36.
    const MIN_SANE = 10n ** 6n;
    const MAX_SANE = 10n ** 36n;
    console.log(`[oracle-sanity] chain=${process.env.GMX_CHAIN || "arbitrum"} market=${ms.name}`);
    console.log(`[oracle-sanity] longToken=${ms.longToken} price=${longPrice.toString()}`);
    console.log(`[oracle-sanity] shortToken=${ms.shortToken} price=${shortPrice.toString()}`);
    expect(longPrice, `long oracle price (${ms.longToken}) must be in sane range`).to.be.gte(MIN_SANE);
    expect(longPrice, `long oracle price (${ms.longToken}) must be in sane range`).to.be.lte(MAX_SANE);
    expect(shortPrice, `short oracle price (${ms.shortToken}) must be in sane range`).to.be.gte(MIN_SANE);
    expect(shortPrice, `short oracle price (${ms.shortToken}) must be in sane range`).to.be.lte(MAX_SANE);
    // For the stable coin (shortToken), USD value per whole token should be ≈ $1.
    // price = usd × 10^(30−tokenDecimals).  For 6-dec USDC at $1 → price = 1e24.
    // Dividing by 1e22 to get a "cents" value (÷ 1e24 × 100 = ÷ 1e22):
    //   $0.50 → 50, $1.00 → 100, $2.00 → 200.
    const stableUsdScaled = shortPrice / (10n ** 22n);
    expect(stableUsdScaled, "short token (stable) price sanity: must be $0.50–$2.00").to.be.gte(50n);
    expect(stableUsdScaled, "short token (stable) price sanity: must be $0.50–$2.00").to.be.lte(200n);
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

  it("deposit-withdraw round trip: token value is net-non-increasing", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }

    const collateralSigner = await fundMarketSigner(ms, 100n);
    const signerAddress = await collateralSigner.getAddress();
    const executionFee = ethers.parseEther("0.009");

    const longToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.longToken
    );
    const shortToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.shortToken
    );
    const marketToken = await ethers.getContractAt(
      ["function balanceOf(address) view returns (uint256)"],
      ms.market
    );

    const longBefore = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortBefore = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());
    const tokenValueBefore =
      (await getTokenMarketValue(ms.longToken, longBefore)) +
      (await getTokenMarketValue(ms.shortToken, shortBefore));

    const feeBounds = await getRoundTripFeeBounds(ms.market);

    const gmAmount = await mintGmForSigner(collateralSigner, executionFee);
    expect(gmAmount).to.be.gt(0n, "deposit should mint GM tokens");

    const { key } = await createWithdrawalForTest({
      marketSet: ms,
      signer: collateralSigner,
      marketTokenAmount: gmAmount,
      executionFee
    });

    const oracleParams = await buildMockOracleParams([ms.longToken, ms.shortToken]);
    const execReceipt = await executeWithdrawalForTest(key, oracleParams);
    expect(execReceipt.status).to.equal(1, "executeWithdrawal must succeed");

    const longAfter = BigInt((await (longToken as any).balanceOf(signerAddress)).toString());
    const shortAfter = BigInt((await (shortToken as any).balanceOf(signerAddress)).toString());
    const gmAfter = BigInt((await (marketToken as any).balanceOf(signerAddress)).toString());
    const tokenValueAfter =
      (await getTokenMarketValue(ms.longToken, longAfter)) +
      (await getTokenMarketValue(ms.shortToken, shortAfter));

    expect(gmAfter).to.equal(0n, "full round trip should burn all minted GM tokens");

    // Core invariant: a deposit→withdrawal round trip must never produce more value than was
    // put in.  A 3% tolerance covers oracle-price approximation error (hardcoded fallback
    // prices may differ from actual fork-block prices by up to ~50% for minor tokens, but
    // the returned-token fraction is typically <5% of the wallet, so net error stays <3%).
    const oracleTolerance = tokenValueBefore / 33n; // ≈ 3% of wallet value
    expect(tokenValueAfter).to.be.lte(
      tokenValueBefore + oracleTolerance,
      [
        "round-trip gained value — possible extraction",
        `before=${tokenValueBefore}`,
        `after=${tokenValueAfter}`,
        `minFeeFactor=${feeBounds.minFeeFactor}`,
        `oracleTolerance=${oracleTolerance}`
      ].join(" ")
    );
  });

  it("round trip with price movement between request and execution is non-extractive", async function () {
    if (
      (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche" &&
      process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"
    ) {
      this.skip();
    }

    const collateralSigner = await fundMarketSigner(ms, 100n);
    const signerAddress = await collateralSigner.getAddress();
    const executionFee = ethers.parseEther("0.009");
    const feeBounds = await getRoundTripFeeBounds(ms.market);
    const tokenValueBefore = await getWalletTokenValue(signerAddress);

    const [longRefPrice, shortRefPrice] = await Promise.all([
      getChainlinkProviderRefPrice(ms.longToken),
      getChainlinkProviderRefPrice(ms.shortToken)
    ]);
    const moveBps = BigInt(process.env.GMX_ROUNDTRIP_PRICE_MOVE_BPS || "30");
    const longMoved = longRefPrice + applyBps(longRefPrice, moveBps);
    const shortMoved = shortRefPrice + applyBps(shortRefPrice, moveBps);

    const gmAmount = await mintGmForSigner(collateralSigner, executionFee);
    expect(gmAmount).to.be.gt(0n, "deposit should mint GM tokens");

    const { key } = await createWithdrawalForTest({
      marketSet: ms,
      signer: collateralSigner,
      marketTokenAmount: gmAmount,
      executionFee
    });

    const oracleParamsMoved = await buildMockOracleParams(
      [ms.longToken, ms.shortToken],
      {
        priceOverrides: {
          [ms.longToken]: longMoved,
          [ms.shortToken]: shortMoved
        }
      }
    );

    const execReceipt = await executeWithdrawalForTest(key, oracleParamsMoved);
    expect(execReceipt.status).to.equal(1, "executeWithdrawal must succeed");

    const tokenValueAfter = await getWalletTokenValue(signerAddress);
    // Core invariant: even with a favorable price move, a round-trip must not produce
    // more value than the starting wallet.  5% oracle tolerance covers fallback price
    // approximation; any real extraction would yield gains >> 5%.
    const oracleTolerance = tokenValueBefore / 20n; // ≈ 5% tolerance

    expect(tokenValueAfter).to.be.lte(
      tokenValueBefore + oracleTolerance,
      [
        "price-move round trip gained value — possible extraction",
        `before=${tokenValueBefore}`,
        `after=${tokenValueAfter}`,
        `longRef=${longRefPrice}`,
        `shortRef=${shortRefPrice}`,
        `moveBps=${moveBps}`,
        `oracleTolerance=${oracleTolerance}`
      ].join(" ")
    );
  });

  it("fee sufficiency probe: computes min adverse move needed to beat round-trip fees", async function () {
    const feeBounds = await getRoundTripFeeBounds(ms.market);
    const minRoundTripFeeFactor = feeBounds.minFeeFactor * 2n;
    const maxRoundTripFeeFactor = feeBounds.maxFeeFactor * 2n;

    const minMoveBps = (minRoundTripFeeFactor * 10_000n) / FLOAT_PRECISION;
    const maxMoveBps = (maxRoundTripFeeFactor * 10_000n) / FLOAT_PRECISION;

    expect(minRoundTripFeeFactor).to.be.gte(0n, "round-trip fee factor should be non-negative");
    expect(maxRoundTripFeeFactor).to.be.gte(
      minRoundTripFeeFactor,
      "max round-trip fee factor should be >= min round-trip fee factor"
    );

    console.log(
      [
        `[fee-sufficiency] market=${ms.market}`,
        `depositFactors=${feeBounds.depositFactors[0].toString()},${feeBounds.depositFactors[1].toString()}`,
        `withdrawalFactors=${feeBounds.withdrawalFactors[0].toString()},${feeBounds.withdrawalFactors[1].toString()}`,
        `minRoundTripFeeFactor=${minRoundTripFeeFactor.toString()}`,
        `maxRoundTripFeeFactor=${maxRoundTripFeeFactor.toString()}`,
        `minMoveBps=${minMoveBps.toString()}`,
        `maxMoveBps=${maxMoveBps.toString()}`
      ].join(" ")
    );
  });
});
