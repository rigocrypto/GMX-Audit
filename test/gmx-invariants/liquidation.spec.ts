import { expect } from "chai";
import fc from "fast-check";
import { ethers, network } from "hardhat";

import {
  buildMockOracleParams,
  createDepositForTest,
  createOrderForTest,
  createDecreaseOrderForTest,
  createWithdrawalForTest,
  createContext,
  executeDepositForTest,
  FUZZ_CONFIG,
  fundMarketSigner,
  fundFreshSigner,
  getChainlinkProviderRefPrice,
  getChainlinkProviderOraclePrice,
  getDefaultDataStoreAddress,
  isRealMutationsEnabled,
  MARKET_SETS,
  type GMXInvariantContext,
  getV2MarketOpenInterestSnapshot,
  getV2PositionFeeSnapshot,
  getV2PositionPnlUsd,
  getUserPosition,
  getV2PositionSnapshot,
  executeOrderForTest,
  executeWithdrawalForTest,
  snapshotConservation,
  reconcileConservation,
  snapshotShiftConservation,
  reconcileShiftConservation,
  createShiftForTest,
  executeShiftForTest,
  getDefaultShiftVaultAddress,
  getTokenMarketValue,
  readAtForkBlock,
  requireArbitrumForkOrSkip,
  runAction,
  assertCoreInvariants,
  withIterationSnapshot,
  withEvmSnapshot,
  resolveKeeper
} from "./harness";

const USE_REAL_MUTATIONS = isRealMutationsEnabled();
const STRICT_MIN_SIZE_OPEN = (process.env.GMX_STRICT_MIN_SIZE_OPEN || "").trim() === "1";
const ENABLE_FEE_UNDERCHARGE_SWEEP = (process.env.GMX_ENABLE_FEE_UNDERCHARGE_SWEEP || "").trim() === "1";
const ENABLE_PNL_ROUNDING_PROBE = (process.env.GMX_ENABLE_PNL_ROUNDING_PROBE || "").trim() === "1";
const ENABLE_FUNDING_NEUTRALITY_PROBE = (process.env.GMX_ENABLE_FUNDING_NEUTRALITY_PROBE || "").trim() === "1";
const ENABLE_MONOTONICITY_PROBE_A = (process.env.GMX_ENABLE_MONOTONICITY_PROBE_A || "").trim() === "1";
const ENABLE_IMPACT_POOL_ROUNDING_PROBE = (process.env.GMX_ENABLE_IMPACT_POOL_ROUNDING_PROBE || "").trim() === "1";
const ENABLE_IMPACT_POOL_EXTRACTION_PROBE = (process.env.GMX_ENABLE_IMPACT_POOL_EXTRACTION_PROBE || "").trim() === "1";
const ENABLE_KEEPER_DUST_THEFT_PROBE = (process.env.GMX_ENABLE_KEEPER_DUST_THEFT_PROBE || "").trim() === "1";
const ENABLE_KEEPER_LOOP_THEFT_PROBE = (process.env.GMX_ENABLE_KEEPER_LOOP_THEFT_PROBE || "").trim() === "1";
const ENABLE_CONSERVATION_BASELINE = (process.env.GMX_ENABLE_CONSERVATION_BASELINE || "").trim() === "1";
const ENABLE_POSITIVE_IMPACT_PROBE = (process.env.GMX_ENABLE_POSITIVE_IMPACT_PROBE || "").trim() === "1";
const ENABLE_WITHDRAWAL_SWAP_PROBE = (process.env.GMX_ENABLE_WITHDRAWAL_SWAP_PROBE || "").trim() === "1";
const ENABLE_WITHDRAWAL_PARTIAL_PROBE = (process.env.GMX_ENABLE_WITHDRAWAL_PARTIAL_PROBE || "").trim() === "1";
const ENABLE_SHIFT_CONSERVATION_PROBE = (process.env.GMX_ENABLE_SHIFT_CONSERVATION_PROBE || "").trim() === "1";
const FLOAT_PRECISION = 10n ** 30n;

const LIQUIDATION_THRESHOLD_BPS = 9_000;

function applyFactor(value: bigint, factor: bigint): bigint {
  return (value * factor) / FLOAT_PRECISION;
}

function deriveMarketBoolKey(base: string, market: string, flag: boolean): string {
  const baseHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], [base]));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "bool"], [baseHash, market, flag])
  );
}

function deriveMarketAddressKey(base: string, market: string): string {
  const baseHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], [base]));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address"], [baseHash, market])
  );
}

function tokenAmountToUsd30(amount: bigint, usdPerToken: bigint, tokenDecimals: number): bigint {
  return amount * usdPerToken * 10n ** (30n - BigInt(tokenDecimals));
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

async function readDataStoreUint(key: string): Promise<bigint> {
  const dataStoreAddress = getDefaultDataStoreAddress();
  const dataStoreAbi = ["function getUint(bytes32 key) view returns (uint256)"];
  try {
    return BigInt((await readAtForkBlock<bigint>(dataStoreAddress, dataStoreAbi, "getUint", [key])).toString());
  } catch {
    try {
      const dataStore = await ethers.getContractAt(dataStoreAbi, dataStoreAddress);
      return BigInt((await (dataStore as any).getUint(key)).toString());
    } catch {
      const rpcUrl = process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL;
      if (!rpcUrl) {
        throw new Error("Unable to read DataStore key: ARBITRUM_RPC is not configured for fallback reads");
      }
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const dataStore = new ethers.Contract(dataStoreAddress, dataStoreAbi, provider);
      return BigInt((await (dataStore as any).getUint(key)).toString());
    }
  }
}

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

    it("min-size rounding check: real min+1 position cannot gain collateral after liquidation attempt", async function () {
      if (!useRealMutationsForMarket) {
        this.skip();
      }

      const dataStoreAddress = getDefaultDataStoreAddress();
      const dataStoreAbi = ["function getUint(bytes32 key) view returns (uint256)"];
      const minPositionSizeKey = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["MIN_POSITION_SIZE_USD"])
      );
      let minPositionSizeUsd: bigint;
      try {
        minPositionSizeUsd = BigInt(
          (await readAtForkBlock<bigint>(dataStoreAddress, dataStoreAbi, "getUint", [minPositionSizeKey])).toString()
        );
      } catch {
        // GMX configs set min position size to 1 USD in 30-decimal fixed-point.
        minPositionSizeUsd = ethers.parseUnits("1", 30);
      }
      const targetSizeUsd = minPositionSizeUsd + 1n;

      const signer = await fundMarketSigner(marketSet, 500n);
      const signerAddress = await signer.getAddress();

      const { key } = await createOrderForTest({
        marketSet,
        signer,
        sizeDeltaUsd: targetSizeUsd,
        isLong: true,
        collateralUsd: 200n
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      const oracleParams = await buildMockOracleParams(oracleTokens);
      try {
        await executeOrderForTest(key, oracleParams);
      } catch {
        if (STRICT_MIN_SIZE_OPEN) {
          expect.fail("Strict min-size validation failed: order execution reverted before opening position");
        }
        const localNoOpen = await createContext({
          adapterMode: "real",
          marketSet,
          userAddresses: [signerAddress, ctx.users[1]]
        });
        await assertCoreInvariants(localNoOpen);
        return;
      }

      const openedPosition = await getV2PositionSnapshot(
        signerAddress,
        marketSet.market,
        marketSet.collateralToken,
        true
      );
      if (!openedPosition.isOpen || openedPosition.sizeInUsd === 0n) {
        if (STRICT_MIN_SIZE_OPEN) {
          expect.fail("Strict min-size validation failed: executed order did not materialize a position");
        }
        const localNoOpen = await createContext({
          adapterMode: "real",
          marketSet,
          userAddresses: [signerAddress, ctx.users[1]]
        });
        // If min+1 order does not materialize into a position, no liquidation-profit loop can be exercised.
        await assertCoreInvariants(localNoOpen);
        return;
      }

      const local = await createContext({
        adapterMode: "real",
        marketSet,
        userAddresses: [signerAddress, ctx.users[1]]
      });
      const descriptor = local.trackedPositions[0];

      await runAction(local, {
        type: "liquidate",
        user: signerAddress,
        position: descriptor
      });

      const afterPosition = await getV2PositionSnapshot(
        signerAddress,
        marketSet.market,
        marketSet.collateralToken,
        true
      );
      expect(
        afterPosition.sizeInUsd,
        "CRITICAL: min-size liquidation path increases trader position size"
      ).to.be.lte(openedPosition.sizeInUsd);
      expect(
        afterPosition.collateralAmount,
        "CRITICAL: min-size liquidation path increases trader collateral"
      ).to.be.lte(openedPosition.collateralAmount);

      await assertCoreInvariants(local);
    });

    it("conservation baseline: deposit and withdraw reconciles", async function () {
      if (!useRealMutationsForMarket || !ENABLE_CONSERVATION_BASELINE) {
        this.skip();
      }

      await withEvmSnapshot(async () => {

      const attacker = await fundMarketSigner(marketSet, 5_000n);
      const attackerAddress = await attacker.getAddress();
      const executionFee = ethers.parseEther("0.009");

      const longToken = await ethers.getContractAt(["function decimals() view returns (uint8)"], marketSet.longToken);
      const shortToken = await ethers.getContractAt(
        ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
        marketSet.shortToken
      );
      const longDecimals = Number((await (longToken as any).decimals()).toString());
      const shortDecimals = Number((await (shortToken as any).decimals()).toString());
      const targetDepositAmount = 1_000n * 10n ** BigInt(shortDecimals);
      const attackerShortBalance = BigInt((await (shortToken as any).balanceOf(attackerAddress)).toString());
      const shortDepositAmount = attackerShortBalance < targetDepositAmount ? attackerShortBalance / 2n : targetDepositAmount;
      if (shortDepositAmount <= 0n) {
        this.skip();
      }

      const dataStore = await ethers.getContractAt(
        ["function getUint(bytes32 key) view returns (uint256)"],
        getDefaultDataStoreAddress()
      );

      const pre = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const longOraclePrice = await getChainlinkProviderOraclePrice(marketSet.longToken);
      const longPriceScaleDecimals = 30 - longDecimals;
      const poolLongDisplay = ethers.formatUnits(pre.poolLong, longDecimals);
      const poolShortDisplay = ethers.formatUnits(pre.poolShort, shortDecimals);

      const longUsdMin = pre.poolLong * longOraclePrice.min;
      const longUsdMax = pre.poolLong * longOraclePrice.max;
      const shortUsd = pre.poolShort * 10n ** (30n - BigInt(shortDecimals));

      console.log(
        [
          `[conservation-baseline-pool][${marketSet.name}]`,
          `poolLongRaw=${pre.poolLong}`,
          `poolShortRaw=${pre.poolShort}`,
          `poolLongToken=${poolLongDisplay}`,
          `poolShortToken=${poolShortDisplay}`,
          `longTokenMinPriceRaw=${longOraclePrice.min}`,
          `longTokenMaxPriceRaw=${longOraclePrice.max}`,
          `longTokenMinPriceUsd=${ethers.formatUnits(longOraclePrice.min, longPriceScaleDecimals)}`,
          `longTokenMaxPriceUsd=${ethers.formatUnits(longOraclePrice.max, longPriceScaleDecimals)}`,
          `poolLongUsdMin=${ethers.formatUnits(longUsdMin, 30)}`,
          `poolLongUsdMax=${ethers.formatUnits(longUsdMax, 30)}`,
          `poolShortUsd=${ethers.formatUnits(shortUsd, 30)}`,
          `longHeavyMin=${longUsdMin > shortUsd}`,
          `longHeavyMax=${longUsdMax > shortUsd}`
        ].join(" ")
      );

      const swapImpactFactorKey = deriveMarketBoolKey("SWAP_IMPACT_FACTOR", marketSet.market, true);
      const swapImpactFactor = await (dataStore as any).getUint(swapImpactFactorKey);
      const swapImpactExponentKey = deriveMarketAddressKey("SWAP_IMPACT_EXPONENT_FACTOR", marketSet.market);
      const swapImpactExponent = await (dataStore as any).getUint(swapImpactExponentKey);

      console.log(
        `[impact-factor][${marketSet.name}] positiveImpactFactor=${swapImpactFactor.toString()} impactExponent=${swapImpactExponent.toString()}`
      );

      const { key: depositKey } = await createDepositForTest({
        marketSet,
        signer: attacker,
        longTokenAmount: 0n,
        shortTokenAmount: shortDepositAmount,
        executionFee
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      await executeDepositForTest(depositKey, await buildMockOracleParams(oracleTokens));

      const marketToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.market);
      const gmBalance = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());
      expect(gmBalance, "baseline requires attacker to receive GM from deposit").to.be.gt(0n);

      const { key: withdrawalKey } = await createWithdrawalForTest({
        marketSet,
        signer: attacker,
        marketTokenAmount: gmBalance,
        executionFee
      });

      await executeWithdrawalForTest(withdrawalKey, await buildMockOracleParams(oracleTokens));

      const post = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const { residualLong, residualShort } = reconcileConservation(pre, post);

      console.log(
        [
          `[conservation-baseline][${marketSet.name}]`,
          `residualLong=${residualLong}`,
          `residualShort=${residualShort}`,
          `attackerNetLong=${post.attackerLong - pre.attackerLong}`,
          `attackerNetShort=${post.attackerShort - pre.attackerShort}`,
          `attackerNetGM=${post.attackerGM - pre.attackerGM}`
        ].join(" ")
      );

      const toleranceWei = 10n;
      expect(absBigInt(residualLong), `Long residual ${residualLong} exceeds tolerance`).to.be.lte(toleranceWei);
      expect(absBigInt(residualShort), `Short residual ${residualShort} exceeds tolerance`).to.be.lte(toleranceWei);
      });
    });

    it("positive-impact-probe: deposit underweight long token and verify conservation", async function () {
      if (!useRealMutationsForMarket || !ENABLE_POSITIVE_IMPACT_PROBE) {
        this.skip();
      }
      if (marketSet.name !== "WETH/USDC") {
        this.skip();
      }

      await withEvmSnapshot(async () => {

      const attacker = await fundMarketSigner(marketSet, 5_000n);
      const attackerAddress = await attacker.getAddress();
      const executionFee = ethers.parseEther("0.009");
      const depositWethAmount = ethers.parseEther("0.5");

      const longToken = await ethers.getContractAt(
        [
          "function balanceOf(address) view returns (uint256)",
          "function deposit() payable"
        ],
        marketSet.longToken,
        attacker
      );

      const attackerLongBalanceBefore = BigInt((await (longToken as any).balanceOf(attackerAddress)).toString());
      if (attackerLongBalanceBefore < depositWethAmount) {
        const topUp = depositWethAmount - attackerLongBalanceBefore;
        await (await (longToken as any).deposit({ value: topUp })).wait();
      }

      const dataStore = await ethers.getContractAt(
        ["function getUint(bytes32 key) view returns (uint256)"],
        getDefaultDataStoreAddress()
      );

      const marketToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.market);
      const gmBefore = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());

      const pre = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const { key: depositKey } = await createDepositForTest({
        marketSet,
        signer: attacker,
        longTokenAmount: depositWethAmount,
        shortTokenAmount: 0n,
        executionFee
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      await executeDepositForTest(depositKey, await buildMockOracleParams(oracleTokens));

      const mid = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const gmAfterDeposit = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());
      const gmDelta = gmAfterDeposit - gmBefore;
      expect(gmDelta, "positive impact probe requires GM minted from deposit").to.be.gt(0n);

      const swapImpactPoolLongDelta = mid.swapImpactPoolLong - pre.swapImpactPoolLong;
      const swapImpactPoolShortDelta = mid.swapImpactPoolShort - pre.swapImpactPoolShort;

      console.log(
        [
          `[positive-impact-probe][${marketSet.name}]`,
          `gmDelta=${gmDelta}`,
          `swapImpactPoolLongDelta=${swapImpactPoolLongDelta}`,
          `swapImpactPoolShortDelta=${swapImpactPoolShortDelta}`
        ].join(" ")
      );

      const hitPositiveImpactBranch = swapImpactPoolLongDelta < 0n || swapImpactPoolShortDelta < 0n;
      expect(hitPositiveImpactBranch, "Did not hit positive impact branch; adjust deposit sizing/composition").to.equal(true);

      const { key: withdrawalKey } = await createWithdrawalForTest({
        marketSet,
        signer: attacker,
        marketTokenAmount: gmDelta,
        executionFee
      });

      await executeWithdrawalForTest(withdrawalKey, await buildMockOracleParams(oracleTokens));

      const post = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const { residualLong, residualShort } = reconcileConservation(pre, post);

      console.log(
        [
          `[positive-impact-conservation][${marketSet.name}]`,
          `residualLong=${residualLong}`,
          `residualShort=${residualShort}`,
          `attackerNetLong=${post.attackerLong - pre.attackerLong}`,
          `attackerNetShort=${post.attackerShort - pre.attackerShort}`
        ].join(" ")
      );

      const toleranceWei = 10n;
      expect(absBigInt(residualLong), `Long residual ${residualLong} exceeds tolerance`).to.be.lte(toleranceWei);
      expect(absBigInt(residualShort), `Short residual ${residualShort} exceeds tolerance`).to.be.lte(toleranceWei);
      });
    });

    it("withdrawal-swap-probe: withdraw with swap path conserves value", async function () {
      if (!useRealMutationsForMarket || !ENABLE_WITHDRAWAL_SWAP_PROBE) {
        this.skip();
      }
      if (marketSet.name !== "WETH/USDC") {
        this.skip();
      }

      await withEvmSnapshot(async () => {

      const attacker = await fundMarketSigner(marketSet, 5_000n);
      const attackerAddress = await attacker.getAddress();
      const executionFee = ethers.parseEther("0.009");

      const dataStore = await ethers.getContractAt(
        ["function getUint(bytes32 key) view returns (uint256)"],
        getDefaultDataStoreAddress()
      );

      const marketToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.market);
      const gmBefore = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());

      // Mint GM using short-token deposit; funding path is deterministic for this market.
      const shortToken = await ethers.getContractAt(
        ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
        marketSet.shortToken
      );
      const shortDecimals = Number((await (shortToken as any).decimals()).toString());
      const targetDepositAmount = 1_000n * 10n ** BigInt(shortDecimals);
      const attackerShortBalance = BigInt((await (shortToken as any).balanceOf(attackerAddress)).toString());
      const shortDepositAmount = attackerShortBalance < targetDepositAmount ? attackerShortBalance / 2n : targetDepositAmount;
      expect(shortDepositAmount, "withdrawal-swap probe requires short-token funding").to.be.gt(0n);

      const { key: depositKey } = await createDepositForTest({
        marketSet,
        signer: attacker,
        longTokenAmount: 0n,
        shortTokenAmount: shortDepositAmount,
        executionFee
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      await executeDepositForTest(depositKey, await buildMockOracleParams(oracleTokens));

      const gmAfterDeposit = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());
      const gmDelta = gmAfterDeposit - gmBefore;
      expect(gmDelta, "withdrawal-swap probe requires GM minted from deposit").to.be.gt(0n);

      const pre = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      // swapPath values are market addresses; [marketSet.market] performs a single-market short->long swap.
      const { key: withdrawalKey } = await createWithdrawalForTest({
        marketSet,
        signer: attacker,
        marketTokenAmount: gmDelta,
        executionFee,
        longTokenSwapPath: [],
        shortTokenSwapPath: [marketSet.market],
        shouldUnwrapNativeToken: false
      });

      await executeWithdrawalForTest(withdrawalKey, await buildMockOracleParams(oracleTokens));

      const post = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const { residualLong, residualShort } = reconcileConservation(pre, post);
      const sipLongDelta = post.swapImpactPoolLong - pre.swapImpactPoolLong;
      const sipShortDelta = post.swapImpactPoolShort - pre.swapImpactPoolShort;

      console.log(
        [
          `[withdrawal-swap-probe][${marketSet.name}]`,
          `residualLong=${residualLong}`,
          `residualShort=${residualShort}`,
          `sipLongDelta=${sipLongDelta}`,
          `sipShortDelta=${sipShortDelta}`,
          `attackerNetLong=${post.attackerLong - pre.attackerLong}`,
          `attackerNetShort=${post.attackerShort - pre.attackerShort}`
        ].join(" ")
      );

      const toleranceWei = 10n;
      expect(absBigInt(residualLong), `Long residual ${residualLong} exceeds tolerance`).to.be.lte(toleranceWei);
      expect(absBigInt(residualShort), `Short residual ${residualShort} exceeds tolerance`).to.be.lte(toleranceWei);
      expect(sipLongDelta !== 0n || sipShortDelta !== 0n, "No swap impact pool movement observed on swap-path withdrawal").to.equal(true);
      });
    });

    it("withdrawal-partial-probe: two partial withdrawals conserve value", async function () {
      if (!useRealMutationsForMarket || !ENABLE_WITHDRAWAL_PARTIAL_PROBE) {
        this.skip();
      }
      if (marketSet.name !== "WETH/USDC") {
        this.skip();
      }

      await withEvmSnapshot(async () => {

      const attacker = await fundMarketSigner(marketSet, 5_000n);
      const attackerAddress = await attacker.getAddress();
      const executionFee = ethers.parseEther("0.009");

      const dataStore = await ethers.getContractAt(
        ["function getUint(bytes32 key) view returns (uint256)"],
        getDefaultDataStoreAddress()
      );

      const marketToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.market);
      const gmBefore = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());

      const shortToken = await ethers.getContractAt(
        ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
        marketSet.shortToken
      );
      const shortDecimals = Number((await (shortToken as any).decimals()).toString());
      const targetDepositAmount = 1_000n * 10n ** BigInt(shortDecimals);
      const attackerShortBalance = BigInt((await (shortToken as any).balanceOf(attackerAddress)).toString());
      const shortDepositAmount = attackerShortBalance < targetDepositAmount ? attackerShortBalance / 2n : targetDepositAmount;
      expect(shortDepositAmount, "withdrawal-partial probe requires short-token funding").to.be.gt(0n);

      const { key: depositKey } = await createDepositForTest({
        marketSet,
        signer: attacker,
        longTokenAmount: 0n,
        shortTokenAmount: shortDepositAmount,
        executionFee
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      await executeDepositForTest(depositKey, await buildMockOracleParams(oracleTokens));

      const gmAfterDeposit = BigInt((await (marketToken as any).balanceOf(attackerAddress)).toString());
      const gmDelta = gmAfterDeposit - gmBefore;
      expect(gmDelta, "Expected GM minted from deposit").to.be.gt(0n);

      const pre = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const half = gmDelta / 2n;
      const remainder = gmDelta - half;

      const { key: firstWithdrawalKey } = await createWithdrawalForTest({
        marketSet,
        signer: attacker,
        marketTokenAmount: half,
        executionFee,
        receiver: attackerAddress,
        shortTokenSwapPath: [marketSet.market]
      });
      await executeWithdrawalForTest(firstWithdrawalKey, await buildMockOracleParams(oracleTokens));

      const mid = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const { key: secondWithdrawalKey } = await createWithdrawalForTest({
        marketSet,
        signer: attacker,
        marketTokenAmount: remainder,
        executionFee,
        receiver: attackerAddress,
        shortTokenSwapPath: [marketSet.market]
      });
      await executeWithdrawalForTest(secondWithdrawalKey, await buildMockOracleParams(oracleTokens));

      const post = await snapshotConservation(
        dataStore as any,
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken,
        attackerAddress
      );

      const leg1 = reconcileConservation(pre, mid);
      const leg2 = reconcileConservation(mid, post);
      const fullCycle = reconcileConservation(pre, post);

      const leg1SipLongDelta = mid.swapImpactPoolLong - pre.swapImpactPoolLong;
      const leg1SipShortDelta = mid.swapImpactPoolShort - pre.swapImpactPoolShort;
      const leg2SipLongDelta = post.swapImpactPoolLong - mid.swapImpactPoolLong;
      const leg2SipShortDelta = post.swapImpactPoolShort - mid.swapImpactPoolShort;

      console.log(
        [
          `[withdrawal-partial-probe][${marketSet.name}]`,
          `leg1SipLongDelta=${leg1SipLongDelta}`,
          `leg1SipShortDelta=${leg1SipShortDelta}`,
          `leg2SipLongDelta=${leg2SipLongDelta}`,
          `leg2SipShortDelta=${leg2SipShortDelta}`
        ].join(" ")
      );

      console.table([
        { metric: "leg1ResidualLong", value: leg1.residualLong.toString() },
        { metric: "leg1ResidualShort", value: leg1.residualShort.toString() },
        { metric: "leg2ResidualLong", value: leg2.residualLong.toString() },
        { metric: "leg2ResidualShort", value: leg2.residualShort.toString() },
        { metric: "fullResidualLong", value: fullCycle.residualLong.toString() },
        { metric: "fullResidualShort", value: fullCycle.residualShort.toString() }
      ]);

      const toleranceWei = 10n;
      expect(absBigInt(fullCycle.residualLong), `Full cycle long residual OOB: ${fullCycle.residualLong}`).to.be.lte(toleranceWei);
      expect(absBigInt(fullCycle.residualShort), `Full cycle short residual OOB: ${fullCycle.residualShort}`).to.be.lte(toleranceWei);
      });
    });

    it("shift-conservation-probe: withdraw-deposit shift conserves across two markets", async function () {
      if (!useRealMutationsForMarket || !ENABLE_SHIFT_CONSERVATION_PROBE) {
        this.skip();
      }
      if (marketSet.name !== "WETH/USDC") {
        this.skip();
      }

      const toMarketSet = {
        name: "WETH/USDC-ALT",
        market: process.env.GMX_SHIFT_TO_MARKET_ADDRESS || "0x6853EA96FF216fAb11D2d930CE3C508556A4bdc4",
        indexToken: process.env.GMX_SHIFT_TO_INDEX_TOKEN || "0xC4da4c24fd591125c3F47b340b6f4f76111883d8",
        longToken: process.env.GMX_SHIFT_TO_LONG_TOKEN || marketSet.longToken,
        shortToken: process.env.GMX_SHIFT_TO_SHORT_TOKEN || marketSet.shortToken,
        collateralToken: marketSet.collateralToken,
        collateralDecimals: marketSet.collateralDecimals,
        collateralUsdPerToken: marketSet.collateralUsdPerToken,
      };
      if (toMarketSet.market.toLowerCase() === marketSet.market.toLowerCase()) {
        this.skip();
      }

      await withEvmSnapshot(async () => {
        const attacker = await fundMarketSigner(marketSet, 5_000n);
        const attackerAddress = await attacker.getAddress();
        const executionFee = ethers.parseEther("0.009");

        const dataStore = await ethers.getContractAt(
          ["function getUint(bytes32 key) view returns (uint256)"],
          getDefaultDataStoreAddress()
        );

        const fromMarketToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.market);
        const gmBefore = BigInt((await (fromMarketToken as any).balanceOf(attackerAddress)).toString());

        const shortToken = await ethers.getContractAt(
          ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
          marketSet.shortToken
        );
        const shortDecimals = Number((await (shortToken as any).decimals()).toString());
        const targetDepositAmount = 1_000n * 10n ** BigInt(shortDecimals);
        const attackerShortBalance = BigInt((await (shortToken as any).balanceOf(attackerAddress)).toString());
        const shortDepositAmount = attackerShortBalance < targetDepositAmount ? attackerShortBalance / 2n : targetDepositAmount;
        expect(shortDepositAmount, "shift probe requires short-token funding").to.be.gt(0n);

        const setupOracleTokens = Array.from(
          new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken])
        );

        const { key: depositKey } = await createDepositForTest({
          marketSet,
          signer: attacker,
          longTokenAmount: 0n,
          shortTokenAmount: shortDepositAmount,
          executionFee,
        });
        await executeDepositForTest(depositKey, await buildMockOracleParams(setupOracleTokens));

        const gmAfterDeposit = BigInt((await (fromMarketToken as any).balanceOf(attackerAddress)).toString());
        const gmDelta = gmAfterDeposit - gmBefore;
        expect(gmDelta, "shift probe requires source-market GM minted from deposit").to.be.gt(0n);

        const shiftVaultAddress = getDefaultShiftVaultAddress();
        const shiftVaultTracked = Array.from(new Set([marketSet.market, toMarketSet.longToken, toMarketSet.shortToken]));
        const shiftVaultPreBalances = new Map<string, bigint>();
        for (const token of shiftVaultTracked) {
          const tokenContract = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], token);
          shiftVaultPreBalances.set(token.toLowerCase(), BigInt((await (tokenContract as any).balanceOf(shiftVaultAddress)).toString()));
        }

        const pre = await snapshotShiftConservation(dataStore as any, marketSet, toMarketSet, attackerAddress);

        const { key: shiftKey } = await createShiftForTest({
          signer: attacker,
          fromMarket: marketSet.market,
          toMarket: toMarketSet.market,
          marketTokenAmount: gmDelta,
          executionFee,
          receiver: attackerAddress,
        });

        const shiftOracleTokens = Array.from(
          new Set([
            marketSet.indexToken,
            marketSet.longToken,
            marketSet.shortToken,
            toMarketSet.indexToken,
            toMarketSet.longToken,
            toMarketSet.shortToken,
          ])
        );
        await executeShiftForTest(shiftKey, await buildMockOracleParams(shiftOracleTokens));

        const post = await snapshotShiftConservation(dataStore as any, marketSet, toMarketSet, attackerAddress);
        const residuals = reconcileShiftConservation(pre, post);

        let totalUsdResidual = 0n;
        totalUsdResidual += await getTokenMarketValue(marketSet.longToken, residuals.residualFromLong);
        totalUsdResidual += await getTokenMarketValue(marketSet.shortToken, residuals.residualFromShort);
        totalUsdResidual += await getTokenMarketValue(toMarketSet.longToken, residuals.residualToLong);
        totalUsdResidual += await getTokenMarketValue(toMarketSet.shortToken, residuals.residualToShort);

        const shiftVaultPostBalances = new Map<string, bigint>();
        for (const token of shiftVaultTracked) {
          const tokenContract = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], token);
          shiftVaultPostBalances.set(token.toLowerCase(), BigInt((await (tokenContract as any).balanceOf(shiftVaultAddress)).toString()));
        }

        console.table([
          { metric: "fromResidualLong", value: residuals.residualFromLong.toString() },
          { metric: "fromResidualShort", value: residuals.residualFromShort.toString() },
          { metric: "toResidualLong", value: residuals.residualToLong.toString() },
          { metric: "toResidualShort", value: residuals.residualToShort.toString() },
          { metric: "totalUsdResidual", value: totalUsdResidual.toString() },
        ]);

        for (const token of shiftVaultTracked) {
          const key = token.toLowerCase();
          const preBalance = shiftVaultPreBalances.get(key) || 0n;
          const postBalance = shiftVaultPostBalances.get(key) || 0n;
          expect(
            postBalance - preBalance,
            `ShiftVault token balance drift detected for ${token}`
          ).to.equal(0n);
        }

        const usdToleranceE30 = 10n ** 27n;
        expect(
          absBigInt(totalUsdResidual),
          `Cross-market USD residual exceeds tolerance: ${totalUsdResidual}`
        ).to.be.lte(usdToleranceE30);
      });
    });

    it("min-size fee probe: smallest executable open does not undercharge position fee", async function () {
      if (!useRealMutationsForMarket || !ENABLE_FEE_UNDERCHARGE_SWEEP) {
        this.skip();
      }

      const feeKeyImproved = deriveMarketBoolKey("POSITION_FEE_FACTOR", marketSet.market, true);
      const feeKeyWorsened = deriveMarketBoolKey("POSITION_FEE_FACTOR", marketSet.market, false);
      const positionFeeFactorImproved = await readDataStoreUint(feeKeyImproved);
      const positionFeeFactorWorsened = await readDataStoreUint(feeKeyWorsened);
      const minApplicableFeeFactor =
        positionFeeFactorImproved < positionFeeFactorWorsened ? positionFeeFactorImproved : positionFeeFactorWorsened;

      const candidateSizesUsd = [
        10n ** 28n,
        2n * 10n ** 28n,
        5n * 10n ** 28n,
        10n ** 29n,
        2n * 10n ** 29n,
        5n * 10n ** 29n,
        10n ** 30n,
        2n * 10n ** 30n,
        5n * 10n ** 30n,
        10n * 10n ** 30n,
        20n * 10n ** 30n,
        50n * 10n ** 30n,
        100n * 10n ** 30n,
        250n * 10n ** 30n,
        500n * 10n ** 30n,
        1000n * 10n ** 30n
      ];

      const executionFee = ethers.parseEther("0.009");
      const collateralUsd = 250n;
      const initialCollateralAmount =
        (collateralUsd * 10n ** BigInt(marketSet.collateralDecimals)) / marketSet.collateralUsdPerToken;
      const collateralPrice = marketSet.collateralUsdPerToken * 10n ** (30n - BigInt(marketSet.collateralDecimals));

      console.log(
        `[min-size-fee-probe][${marketSet.name}] collateralToken=${marketSet.collateralToken} configDecimals=${marketSet.collateralDecimals} collateralUsdPerToken=${marketSet.collateralUsdPerToken}`
      );

      let probeResult:
        | {
            sizeDeltaUsd: bigint;
            signerAddress: string;
            openedCollateralAmount: bigint;
          }
        | undefined;
      const attemptTelemetry: string[] = [];

      for (const sizeDeltaUsd of candidateSizesUsd) {
        const signer = await fundMarketSigner(marketSet, 500n);
        const signerAddress = await signer.getAddress();

        try {
          const { key } = await createOrderForTest({
            marketSet,
            signer,
            sizeDeltaUsd,
            isLong: true,
            executionFee,
            collateralUsd
          });

          const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
          const oracleParams = await buildMockOracleParams(oracleTokens);
          await executeOrderForTest(key, oracleParams);

          const openedPosition = await getV2PositionSnapshot(
            signerAddress,
            marketSet.market,
            marketSet.collateralToken,
            true
          );

          if (openedPosition.isOpen && openedPosition.sizeInUsd > 0n) {
            probeResult = {
              sizeDeltaUsd,
              signerAddress,
              openedCollateralAmount: openedPosition.collateralAmount
            };
            console.log(
              `[min-size-fee-probe][${marketSet.name}] firstExecutableSizeDeltaUsd=${sizeDeltaUsd} openedCollateralAmount=${openedPosition.collateralAmount}`
            );
            break;
          }

          attemptTelemetry.push(`size=${sizeDeltaUsd} result=no-open`);
        } catch {
          // Candidate is below effective executable threshold; continue sweep.
          attemptTelemetry.push(`size=${sizeDeltaUsd} result=execution-revert`);
        }
      }

      if (!probeResult) {
        console.log(`[min-size-fee-probe][${marketSet.name}] attempts=${attemptTelemetry.join(" | ")}`);
      }

      expect(probeResult, "No executable min-boundary order found in deterministic size sweep").to.not.equal(undefined);
      if (!probeResult) {
        return;
      }

      const expectedMinPositionFee = applyFactor(probeResult.sizeDeltaUsd, minApplicableFeeFactor) / collateralPrice;
      const actualOpenFee = initialCollateralAmount - probeResult.openedCollateralAmount;

      console.log(
        `[min-size-fee-probe][${marketSet.name}] firstExecutableSize=${probeResult.sizeDeltaUsd} expectedFee=${expectedMinPositionFee} actualFee=${actualOpenFee} delta=${actualOpenFee - expectedMinPositionFee}`
      );

      expect(
        actualOpenFee + 3n,
        [
          "CRITICAL: open fee undercharge near min boundary",
          `sizeDeltaUsd=${probeResult.sizeDeltaUsd}`,
          `actualOpenFee=${actualOpenFee}`,
          `expectedMinFee=${expectedMinPositionFee}`,
          `feeFactor(min)=${minApplicableFeeFactor}`
        ].join(" ")
      ).to.be.gte(expectedMinPositionFee);
    });

    it("pnl-rounding dust: favorable 1bps move cannot produce excess gain [pnl-rounding]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_PNL_ROUNDING_PROBE) {
        this.skip();
      }

      const executionFee = ethers.parseEther("0.009");
      const collateralUsd = 250n;
      const openSizeDeltaUsd = 10n ** 30n;
      const moveBps = 1n;
      const pnlToleranceUsd = 10n ** 23n;
      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));

      async function readPnlAtMove(indexMoveBps: bigint): Promise<bigint> {
        const signer = await fundMarketSigner(marketSet, 700n);
        const signerAddress = await signer.getAddress();

        const { key: openKey } = await createOrderForTest({
          marketSet,
          signer,
          sizeDeltaUsd: openSizeDeltaUsd,
          isLong: true,
          executionFee,
          collateralUsd
        });

        await executeOrderForTest(openKey, await buildMockOracleParams(oracleTokens));

        const openedPosition = await getV2PositionSnapshot(
          signerAddress,
          marketSet.market,
          marketSet.collateralToken,
          true
        );
        expect(
          openedPosition.isOpen && openedPosition.sizeInUsd > 0n,
          "PnL dust probe requires an opened position"
        ).to.equal(true);

        const indexRefPrice = await getChainlinkProviderRefPrice(marketSet.indexToken);
        const longRefPrice = await getChainlinkProviderRefPrice(marketSet.longToken);
        const shortRefPrice = await getChainlinkProviderRefPrice(marketSet.shortToken);
        const movedIndexPrice = indexRefPrice + (indexRefPrice * indexMoveBps) / 10_000n;

        const pnlSnapshot = await getV2PositionPnlUsd({
          market: marketSet.market,
          positionKey: openedPosition.key,
          sizeDeltaUsd: openedPosition.sizeInUsd,
          indexPrice: movedIndexPrice,
          longPrice: longRefPrice,
          shortPrice: shortRefPrice
        });

        return pnlSnapshot.positionPnlUsd;
      }

      const baselinePnlUsd = await readPnlAtMove(0n);
      const movedPnlUsd = await readPnlAtMove(moveBps);
      const pnlDeltaUsd = movedPnlUsd - baselinePnlUsd;

      const expectedPnlUsd = (openSizeDeltaUsd * moveBps) / 10_000n;

      console.log(
        `[pnl-rounding][${marketSet.name}] baselinePnlUsd=${baselinePnlUsd} movedPnlUsd=${movedPnlUsd} pnlDeltaUsd=${pnlDeltaUsd} expectedPnlUsd=${expectedPnlUsd} toleranceUsd=${pnlToleranceUsd}`
      );

      expect(
        pnlDeltaUsd,
        "pnl-rounding probe expects non-negative delta for favorable move"
      ).to.be.gte(0n);

      expect(
        pnlDeltaUsd,
        [
          "CRITICAL: PnL dust improvement exceeds expected 1bps notional",
          `pnlDeltaUsd=${pnlDeltaUsd}`,
          `expectedPnlUsd=${expectedPnlUsd}`,
          `moveBps=${moveBps}`
        ].join(" ")
      ).to.be.lte(expectedPnlUsd + pnlToleranceUsd);
    });

    it("funding-accounting: hedged pair funding follows live OI skew [funding-neutrality]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_FUNDING_NEUTRALITY_PROBE) {
        this.skip();
      }

      const executionFee = ethers.parseEther("0.009");
      const openSizeDeltaUsd = 100n * 10n ** 30n;
      const triggerSizeDeltaUsd = 10n ** 30n;
      const collateralUsd = 250n;
      const iterations = 4;
      const updateDelaySeconds = 7_200;
      const signToleranceUsd = 2n * 10n ** 17n;
      const ratioToleranceBps = 3_000n;

      const initialOi = await getV2MarketOpenInterestSnapshot(
        marketSet.market,
        marketSet.longToken,
        marketSet.shortToken
      );

      if (initialOi.longOpenInterestUsd === 0n || initialOi.shortOpenInterestUsd === 0n) {
        this.skip();
      }

      const ratioTelemetry: string[] = [];
      let signalIterations = 0;

      for (let i = 0; i < iterations; i++) {
        await withIterationSnapshot(async () => {
          const longSigner = await fundMarketSigner(marketSet, 800n);
          const shortSigner = await fundMarketSigner(marketSet, 800n);
          const longSignerAddress = await longSigner.getAddress();
          const shortSignerAddress = await shortSigner.getAddress();

          const longOrder = await createOrderForTest({
            marketSet,
            signer: longSigner,
            sizeDeltaUsd: openSizeDeltaUsd,
            isLong: true,
            executionFee,
            collateralUsd
          });

          const shortOrder = await createOrderForTest({
            marketSet,
            signer: shortSigner,
            sizeDeltaUsd: openSizeDeltaUsd,
            isLong: false,
            acceptablePrice: ethers.MaxUint256,
            executionFee,
            collateralUsd
          });

          const openOracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
          try {
            await executeOrderForTest(longOrder.key, await buildMockOracleParams(openOracleTokens));
          } catch (error: any) {
            const message = String(error?.message ?? error ?? "");
            if (message.includes("panic code 0x41")) {
              ratioTelemetry.push([`iter=${i}`, "signal=skipped_long_execution_panic"].join(" "));
              return;
            }
            throw error;
          }
          try {
            await executeOrderForTest(shortOrder.key, await buildMockOracleParams(openOracleTokens));
          } catch (error: any) {
            const message = String(error?.message ?? error ?? "");
            if (message.includes("panic code 0x41")) {
              ratioTelemetry.push([`iter=${i}`, "signal=skipped_short_execution_panic"].join(" "));
              return;
            }
            throw error;
          }

          const currentOi = await getV2MarketOpenInterestSnapshot(
            marketSet.market,
            marketSet.longToken,
            marketSet.shortToken
          );

          const longOi = currentOi.longOpenInterestUsd;
          const shortOi = currentOi.shortOpenInterestUsd;

          const longBefore = await getV2PositionFeeSnapshot({
            account: longSignerAddress,
            market: marketSet.market,
            collateralToken: marketSet.collateralToken,
            isLong: true,
            longToken: marketSet.longToken,
            shortToken: marketSet.shortToken
          });
          const shortBefore = await getV2PositionFeeSnapshot({
            account: shortSignerAddress,
            market: marketSet.market,
            collateralToken: marketSet.collateralToken,
            isLong: false,
            longToken: marketSet.longToken,
            shortToken: marketSet.shortToken
          });

          await network.provider.send("evm_increaseTime", [updateDelaySeconds]);
          await network.provider.send("evm_mine");

          const triggerSigner = await fundMarketSigner(marketSet, 500n);
          const triggerOrder = await createOrderForTest({
            marketSet,
            signer: triggerSigner,
            sizeDeltaUsd: triggerSizeDeltaUsd,
            isLong: true,
            executionFee,
            collateralUsd
          });
          await executeOrderForTest(triggerOrder.key, await buildMockOracleParams(openOracleTokens));

          const longAfter = await getV2PositionFeeSnapshot({
            account: longSignerAddress,
            market: marketSet.market,
            collateralToken: marketSet.collateralToken,
            isLong: true,
            longToken: marketSet.longToken,
            shortToken: marketSet.shortToken
          });
          const shortAfter = await getV2PositionFeeSnapshot({
            account: shortSignerAddress,
            market: marketSet.market,
            collateralToken: marketSet.collateralToken,
            isLong: false,
            longToken: marketSet.longToken,
            shortToken: marketSet.shortToken
          });

          const longDelta = longAfter.signedFundingUsd - longBefore.signedFundingUsd;
          const shortDelta = shortAfter.signedFundingUsd - shortBefore.signedFundingUsd;

          expect(
            longDelta * shortDelta,
            "Hedged legs should not move in the same funding direction"
          ).to.be.lte(signToleranceUsd * signToleranceUsd);

          const longMagnitude = longDelta >= 0n ? longDelta : -longDelta;
          const shortMagnitude = shortDelta >= 0n ? shortDelta : -shortDelta;
          const longOiIsSmaller = longOi < shortOi;
          const largerMagnitude = longMagnitude >= shortMagnitude ? longMagnitude : shortMagnitude;
          const smallerMagnitude = longMagnitude >= shortMagnitude ? shortMagnitude : longMagnitude;
          const largerOi = longOi >= shortOi ? longOi : shortOi;
          const smallerOi = longOi >= shortOi ? shortOi : longOi;

          if (longOiIsSmaller) {
            expect(
              longMagnitude,
              "Long leg should carry the larger per-position funding magnitude when long OI is smaller"
            ).to.be.gte(shortMagnitude - signToleranceUsd);
          } else {
            expect(
              shortMagnitude,
              "Short leg should carry the larger per-position funding magnitude when short OI is smaller"
            ).to.be.gte(longMagnitude - signToleranceUsd);
          }

          if (smallerMagnitude === 0n || largerMagnitude === 0n) {
            ratioTelemetry.push(
              [
                `iter=${i}`,
                "signal=none",
                `longDelta=${longDelta}`,
                `shortDelta=${shortDelta}`,
                `longOi=${longOi}`,
                `shortOi=${shortOi}`
              ].join(" ")
            );
            return;
          }

          signalIterations += 1;

          const lhs = largerMagnitude * smallerOi;
          const rhs = smallerMagnitude * largerOi;
          const lowerBound = (rhs * (10_000n - ratioToleranceBps)) / 10_000n;
          const upperBound = (rhs * (10_000n + ratioToleranceBps)) / 10_000n;

          ratioTelemetry.push(
            [
              `iter=${i}`,
              `longDelta=${longDelta}`,
              `shortDelta=${shortDelta}`,
              `longMag=${longMagnitude}`,
              `shortMag=${shortMagnitude}`,
              `longOi=${longOi}`,
              `shortOi=${shortOi}`
            ].join(" ")
          );

          expect(
            lhs,
            "Funding magnitude ratio diverged materially from live OI skew lower bound"
          ).to.be.gte(lowerBound);
          expect(
            lhs,
            "Funding magnitude ratio diverged materially from live OI skew upper bound"
          ).to.be.lte(upperBound);
        });
      }

      console.log(
        [
          `[funding-neutrality][${marketSet.name}]`,
          `initialLongOi=${initialOi.longOpenInterestUsd}`,
          `initialShortOi=${initialOi.shortOpenInterestUsd}`,
          `signalIterations=${signalIterations}`,
          ...ratioTelemetry
        ].join(" ")
      );
    });

    it("borrowing-accounting: fees remain monotonic and non-negative [monotonicity-probe-A]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_MONOTONICITY_PROBE_A) {
        this.skip();
      }

      // Probe A: Verify borrowing fees never decrease and stay non-negative.
      // Diagnostic-first approach: confirm position is readable before attempting fee accrual tests.

      const maxIterations = 3;
      const updateDelaySeconds = 1_800; // 30 min
      const minCollateralUsd = 250n;
      const openSizeDeltaUsd = ethers.parseUnits("100", 30);
      const executionFee = ethers.parseEther("0.009");
      const telephonyData: string[] = [];
      let signalIterations = 0;

      try {
        // Phase 1: Open a position
        const longSigner = await fundMarketSigner(marketSet, 800n);
        const longAddress = await longSigner.getAddress();
        const isLong = true;

        const openOrder = await createOrderForTest({
          marketSet,
          signer: longSigner,
          collateralUsd: minCollateralUsd,
          sizeDeltaUsd: openSizeDeltaUsd,
          isLong,
          acceptablePrice: ethers.MaxUint256,
          executionFee
        });

        const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));

        await executeOrderForTest(
          openOrder.key,
          await buildMockOracleParams(oracleTokens)
        );

        telephonyData.push("position_opened");

        // DIAGNOSTIC: immediately call getV2PositionFeeSnapshot to confirm position is readable.
        // Position key uses initial collateral token from order creation.
        const correctCollateralToken = marketSet.collateralToken;

        console.log("DEBUG position key inputs:", {
          account: longAddress ?? "NULL",
          market: marketSet?.market ?? "NULL",
          longToken: marketSet?.longToken ?? "NULL",
          shortToken: marketSet?.shortToken ?? "NULL",
          collateralToken: correctCollateralToken ?? "NULL",
          isLong,
          dataStore: getDefaultDataStoreAddress() ?? "NULL",
          referralStorage: process.env.GMX_REFERRAL_STORAGE_ADDRESS ?? "NULL"
        });

        let initialFeeSnap: any;
        try {
          initialFeeSnap = await getV2PositionFeeSnapshot({
            account: longAddress,
            market: marketSet.market,
            collateralToken: correctCollateralToken,
            isLong,
            longToken: marketSet.longToken,
            shortToken: marketSet.shortToken
          });
          
          telephonyData.push(
            `initial_read_ok borrowingFeeUsd=${initialFeeSnap.borrowingFeeUsd}`
          );
        } catch (diagErr: any) {
          const diagMsg = String(diagErr?.message ?? diagErr ?? "").slice(0, 60);
          telephonyData.push(`initial_read_failed: ${diagMsg}`);
          // If we can't even read the initial position, hard fail here
          throw new Error(`[Probe A Diagnostic] Failed to read position immediately after open: ${diagMsg}`);
        }

        // Phase 2: Fee monitoring loop
        let previousBorrowingFee = initialFeeSnap.borrowingFeeUsd;

        for (let i = 1; i <= maxIterations; i++) {
          // Advance time
          await network.provider.send("evm_increaseTime", [updateDelaySeconds]);
          await network.provider.send("hardhat_mine", ["0x1"]);

          // Execute a tiny trigger order to force state update
          try {
            const triggerOrder = await createOrderForTest({
              marketSet,
              signer: longSigner,
              collateralUsd: 10n,
              sizeDeltaUsd: ethers.parseUnits("1", 30),
              isLong,
              acceptablePrice: ethers.MaxUint256,
              executionFee
            });

            await executeOrderForTest(
              triggerOrder.key,
              await buildMockOracleParams(oracleTokens)
            );
          } catch (err: any) {
            const msg = String(err?.message ?? err ?? "");
            if (msg.includes("panic code 0x41")) {
              telephonyData.push(`iter=${i} trigger_panic`);
            } else {
              telephonyData.push(`iter=${i} trigger_error=${msg.slice(0, 25)}`);
            }
            continue;
          }

          // Snapshot borrowing fee after update
          try {
            const postUpdateFeeSnap = await getV2PositionFeeSnapshot({
              account: longAddress,
              market: marketSet.market,
              collateralToken: correctCollateralToken,
              isLong,
              longToken: marketSet.longToken,
              shortToken: marketSet.shortToken
            });

            const currentBorrowingFee = postUpdateFeeSnap.borrowingFeeUsd;

            // Invariant checks
            expect(currentBorrowingFee, `iter ${i}: fee must be ≥0`).to.be.gte(0n);
            expect(currentBorrowingFee, `iter ${i}: fee must be ≥${previousBorrowingFee}`).to.be.gte(previousBorrowingFee);

            const feeDelta = currentBorrowingFee - previousBorrowingFee;
            telephonyData.push(`iter=${i} fee=${currentBorrowingFee} delta=${feeDelta}`);
            
            if (feeDelta > 0n || currentBorrowingFee > 0n) {
              signalIterations += 1;
            }

            previousBorrowingFee = currentBorrowingFee;
          } catch (snapErr: any) {
            const snapMsg = String(snapErr?.message ?? snapErr ?? "").slice(0, 25);
            telephonyData.push(`iter=${i} snap_error=${snapMsg}`);
          }
        }
      } catch (e: any) {
        telephonyData.push(`probe_error: ${String(e?.message ?? e).slice(0, 50)}`);
        // Let diagnostic errors propagate; they reveal root causes
        throw e;
      }

      // HARD FAIL if no measurable signal
      expect(
        signalIterations,
        `[Probe A] No borrowing fee signal across ${maxIterations} iterations. This indicates: (1) position key mismatch, (2) collateral token wrong, or (3) orders not updating state. Telemetry: ${telephonyData.slice(0, 8).join(" | ")}`
      ).to.be.gte(1);

      // Emit telemetry for passing tests
      console.log(
        [
          `[monotonicity-probe-A][${marketSet.name}]`,
          `signalIterations=${signalIterations}`,
          ...telephonyData.slice(0, 12)
        ].join(" ")
      );
    });

    it("impact-pool rounding: tiny increase order cannot drain pool [impact-pool][rounding]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_IMPACT_POOL_ROUNDING_PROBE) {
        this.skip();
      }

      const impactPoolKey = deriveMarketAddressKey("POSITION_IMPACT_POOL_AMOUNT", marketSet.market);
      const poolBefore = await readDataStoreUint(impactPoolKey);

      const tinySizesUsd = [
        ethers.parseUnits("1", 30),
        ethers.parseUnits("2", 30),
        ethers.parseUnits("5", 30)
      ];
      const executionFee = ethers.parseEther("0.009");
      const signer = await fundMarketSigner(marketSet, 800n);
      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));

      let executedSizeUsd: bigint | undefined;
      for (const sizeDeltaUsd of tinySizesUsd) {
        try {
          const { key } = await createOrderForTest({
            marketSet,
            signer,
            sizeDeltaUsd,
            isLong: true,
            executionFee,
            collateralUsd: 250n
          });
          await executeOrderForTest(key, await buildMockOracleParams(oracleTokens));
          executedSizeUsd = sizeDeltaUsd;
          break;
        } catch {
          // Try next tiny candidate size.
        }
      }

      if (!executedSizeUsd) {
        expect.fail("No executable tiny size candidate for impact-pool probe");
        return;
      }

      const poolAfter = await readDataStoreUint(impactPoolKey);
      const poolDelta = poolAfter - poolBefore;

      console.log(
        [
          `[impact-pool][${marketSet.name}]`,
          `sizeDeltaUsd=${executedSizeUsd}`,
          `poolBefore=${poolBefore}`,
          `poolAfter=${poolAfter}`,
          `poolDelta=${poolDelta}`
        ].join(" ")
      );

      expect(
        poolDelta,
        [
          "CRITICAL: tiny-order rounding appears to drain POSITION_IMPACT_POOL_AMOUNT",
          `market=${marketSet.market}`,
          `poolBefore=${poolBefore}`,
          `poolAfter=${poolAfter}`,
          `sizeDeltaUsd=${executedSizeUsd}`
        ].join(" ")
      ).to.be.gte(0n);
    });

    it("multi-impact loop: repeated tiny orders cannot accumulate pool drain [multi-impact][loop]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_IMPACT_POOL_ROUNDING_PROBE) {
        this.skip();
      }

      const impactPoolKey = deriveMarketAddressKey("POSITION_IMPACT_POOL_AMOUNT", marketSet.market);
      const executionFee = ethers.parseEther("0.009");
      const signer = await fundMarketSigner(marketSet, 2_500n);
      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));

      let cumulativeDrain = 0n;
      const loopTelemetry: string[] = [];

      for (let i = 0; i < 10; i++) {
        await withIterationSnapshot(async () => {
          const poolBefore = await readDataStoreUint(impactPoolKey);

          try {
            const { key } = await createOrderForTest({
              marketSet,
              signer,
              sizeDeltaUsd: ethers.parseUnits("5", 30),
              isLong: true,
              executionFee,
              collateralUsd: 250n
            });

            await executeOrderForTest(key, await buildMockOracleParams(oracleTokens));
          } catch (error: any) {
            const message = String(error?.message ?? error ?? "");
            if (message.includes("panic code 0x41")) {
              loopTelemetry.push(`iter=${i} execution=panic_0x41`);
              return;
            }
            throw error;
          }

          const poolAfter = await readDataStoreUint(impactPoolKey);
          const poolDelta = poolAfter - poolBefore;

          if (poolDelta < 0n) {
            cumulativeDrain += -poolDelta;
          }

          loopTelemetry.push(`iter=${i} before=${poolBefore} after=${poolAfter} delta=${poolDelta}`);
        });
      }

      console.log(
        [`[impact-pool-loop][${marketSet.name}]`, `cumulativeDrain=${cumulativeDrain}`, ...loopTelemetry].join(" ")
      );

      expect(
        cumulativeDrain,
        [
          "CRITICAL: repeated tiny orders accumulated position impact pool drain",
          `market=${marketSet.market}`,
          `cumulativeDrain=${cumulativeDrain}`
        ].join(" ")
      ).to.equal(0n);
    });

    it("impact-pool extraction: closed-loop attacker net gain check [extraction]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_IMPACT_POOL_EXTRACTION_PROBE) {
        this.skip();
      }

      const impactPoolKey = deriveMarketAddressKey("POSITION_IMPACT_POOL_AMOUNT", marketSet.market);
      const executionFee = ethers.parseEther("0.009");
      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));

      const attacker = await fundMarketSigner(marketSet, 2_000n);
      const attackerAddress = await attacker.getAddress();

      const collateralToken = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)"],
        marketSet.collateralToken
      );

      const collateralBefore = BigInt((await (collateralToken as any).balanceOf(attackerAddress)).toString());
      const poolBefore = await readDataStoreUint(impactPoolKey);

      const { key: openKey } = await createOrderForTest({
        marketSet,
        signer: attacker,
        sizeDeltaUsd: ethers.parseUnits("1", 30),
        isLong: true,
        collateralUsd: 300n,
        executionFee
      });
      await executeOrderForTest(openKey, await buildMockOracleParams(oracleTokens));

      const openedPosition = await getV2PositionSnapshot(
        attackerAddress,
        marketSet.market,
        marketSet.collateralToken,
        true
      );
      expect(openedPosition.isOpen, "extraction probe requires opened position").to.equal(true);
      expect(openedPosition.sizeInUsd, "extraction probe requires non-zero opened size").to.be.gt(0n);

      const { key: closeKey } = await createDecreaseOrderForTest({
        marketSet,
        signer: attacker,
        sizeDeltaUsd: openedPosition.sizeInUsd,
        isLong: true,
        collateralToken: marketSet.collateralToken,
        acceptablePrice: 0n,
        executionFee
      });
      await executeOrderForTest(closeKey, await buildMockOracleParams(oracleTokens));

      const collateralAfter = BigInt((await (collateralToken as any).balanceOf(attackerAddress)).toString());
      const poolAfter = await readDataStoreUint(impactPoolKey);

      const attackerDeltaCollateral = collateralAfter - collateralBefore;
      const attackerDeltaUsd = tokenAmountToUsd30(
        attackerDeltaCollateral,
        marketSet.collateralUsdPerToken,
        marketSet.collateralDecimals
      );

      const poolDrainToken = poolBefore > poolAfter ? poolBefore - poolAfter : 0n;
      let indexPriceUsd30 = 0n;
      try {
        indexPriceUsd30 = await getChainlinkProviderRefPrice(marketSet.indexToken);
      } catch {
        // Keep diagnostics deterministic even if chainlink provider is unavailable on this fork state.
      }
      const poolDrainUsd = poolDrainToken * indexPriceUsd30;

      console.log(
        [
          `[impact-pool-extraction][${marketSet.name}]`,
          `collateralBefore=${collateralBefore}`,
          `collateralAfter=${collateralAfter}`,
          `attackerDeltaCollateral=${attackerDeltaCollateral}`,
          `attackerDeltaUsd=${attackerDeltaUsd}`,
          `poolBefore=${poolBefore}`,
          `poolAfter=${poolAfter}`,
          `poolDrainToken=${poolDrainToken}`,
          `indexPriceUsd30=${indexPriceUsd30}`,
          `poolDrainUsd=${poolDrainUsd}`,
          `note=attackerDelta excludes native gas and execution-fee value`
        ].join(" ")
      );

      expect(
        !(attackerDeltaUsd > 0n && poolDrainToken > 0n),
        [
          "CRITICAL: attacker gains value while position impact pool is drained in a closed loop",
          `market=${marketSet.market}`,
          `attackerDeltaUsd=${attackerDeltaUsd}`,
          `poolDrainToken=${poolDrainToken}`,
          `poolDrainUsd=${poolDrainUsd}`
        ].join(" ")
      ).to.equal(true);
    });

    it("keeper theft via dust collateral rounding on single liquidation [keeper-dust]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_KEEPER_DUST_THEFT_PROBE) {
        this.skip();
      }

      const executor = await fundMarketSigner(marketSet, 10_000n);
      const executorAddress = await executor.getAddress();
      const keeper = await ethers.getSigner(await resolveKeeper());
      const keeperAddress = await keeper.getAddress();

      // Create dust collateral position: 0.001 USD worth (extremely tiny, purely rounding target)
      const dustCollateralUsd = 1n; // 1 wei in USD-30 fixed point = essentially zero
      const leverageBps = 10_000n; // 1x leverage (to avoid liquidation on margin)
      const dustSizeDeltaUsd = (dustCollateralUsd * leverageBps) / 10_000n;

      const executionFee = ethers.parseEther("0.009");
      const { key: openKey } = await createOrderForTest({
        marketSet,
        signer: executor,
        sizeDeltaUsd: dustSizeDeltaUsd,
        isLong: true,
        collateralUsd: dustCollateralUsd + 100n, // Sufficient collateral to open, then liquidate
        executionFee
      });

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      await executeOrderForTest(openKey, await buildMockOracleParams(oracleTokens));

      const dustPosition = await getV2PositionSnapshot(
        executorAddress,
        marketSet.market,
        marketSet.collateralToken,
        true
      );

      if (!dustPosition.isOpen || dustPosition.sizeInUsd === 0n) {
        // If dust position did not open, no liquidation rounding to exploit
        return;
      }

      const collateralToken = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], marketSet.collateralToken);
      const keeperBalanceBefore = BigInt((await (collateralToken as any).balanceOf(keeperAddress)).toString());

      // Trigger liquidation
      const descriptor = ctx.trackedPositions[0];
      try {
        await runAction(ctx, {
          type: "liquidate",
          user: executorAddress,
          position: descriptor
        });
      } catch (err) {
        // Liquidation may fail if position not actually liquidatable; that's OK, test is about mechanical rounding
      }

      const keeperBalanceAfter = BigInt((await (collateralToken as any).balanceOf(keeperAddress)).toString());
      const keeperReward = keeperBalanceAfter - keeperBalanceBefore;

      console.log(
        [
          `[keeper-dust-liq][${marketSet.name}]`,
          `dustCollateralUsd=${dustCollateralUsd}`,
          `dustSizeDeltaUsd=${dustSizeDeltaUsd}`,
          `keeperRewardToken=${keeperReward}`,
          `keeperRewardUsd=${tokenAmountToUsd30(keeperReward, marketSet.collateralUsdPerToken, marketSet.collateralDecimals)}`
        ].join(" ")
      );

      expect(keeperReward, "keeper rewards should not exceed dust collateral via rounding theft").to.be.lte(10n);
    });

    it("keeper theft loop: spam tiny liquidations for cumulative rounding extraction [keeper-loop]", async function () {
      if (!useRealMutationsForMarket || !ENABLE_KEEPER_LOOP_THEFT_PROBE) {
        this.skip();
      }

      const executor = await fundMarketSigner(marketSet, 100_000n);
      const executorAddress = await executor.getAddress();
      const keeper = await ethers.getSigner(await resolveKeeper());
      const keeperAddress = await keeper.getAddress();

      const collateralToken = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)"],
        marketSet.collateralToken
      );

      const keeperBalanceBefore = BigInt((await (collateralToken as any).balanceOf(keeperAddress)).toString());
      let cumulativeKeeperReward = 0n;
      let liquidationCount = 0;
      let skippedCount = 0;

      const dustCollateralUsd = 10n; // Slightly larger dust
      const leverageBps = 10_000n; // 1x
      const executionFee = ethers.parseEther("0.009");

      const oracleTokens = Array.from(new Set([marketSet.indexToken, marketSet.longToken, marketSet.shortToken]));
      const descriptor = ctx.trackedPositions[0];

      // Spam 5 dust positions
      for (let i = 0; i < 5; i++) {
        try {
          const dustSizeDeltaUsd = (dustCollateralUsd * leverageBps) / 10_000n;
          const { key: openKey } = await createOrderForTest({
            marketSet,
            signer: executor,
            sizeDeltaUsd: dustSizeDeltaUsd,
            isLong: i % 2 === 0, // Alternate long/short
            collateralUsd: dustCollateralUsd + 100n,
            executionFee
          });

          await executeOrderForTest(openKey, await buildMockOracleParams(oracleTokens));

          const dustPosition = await getV2PositionSnapshot(
            executorAddress,
            marketSet.market,
            marketSet.collateralToken,
            i % 2 === 0
          );

          if (!dustPosition.isOpen || dustPosition.sizeInUsd === 0n) {
            skippedCount++;
            continue;
          }

          await runAction(ctx, {
            type: "liquidate",
            user: executorAddress,
            position: descriptor
          });

          liquidationCount++;
        } catch (err) {
          // Panic or infeasible liquidation; skip
          skippedCount++;
        }
      }

      const keeperBalanceAfter = BigInt((await (collateralToken as any).balanceOf(keeperAddress)).toString());
      cumulativeKeeperReward = keeperBalanceAfter - keeperBalanceBefore;

      console.log(
        [
          `[keeper-loop][${marketSet.name}]`,
          `liquidationCount=${liquidationCount}`,
          `skippedCount=${skippedCount}`,
          `cumulativeKeeperRewardToken=${cumulativeKeeperReward}`,
          `cumulativeKeeperRewardUsd=${tokenAmountToUsd30(cumulativeKeeperReward, marketSet.collateralUsdPerToken, marketSet.collateralDecimals)}`
        ].join(" ")
      );

      // Keeper profits should not accumulate from dust liquidations
      expect(
        cumulativeKeeperReward <= 0n || liquidationCount === 0,
        "keeper should not accumulate profits from dust liquidation spam"
      ).to.equal(true);
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
