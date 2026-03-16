import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Contract as RpcContract, JsonRpcProvider, type Contract, type Signer } from "ethers";
import fs from "fs";
import path from "path";

import { DEFAULT_DEPLOYED } from "./deployed";
import { GMXAccountingModel } from "./differentialModel";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)"
];

const WRAPPED_NATIVE_ABI = [
  ...ERC20_ABI,
  "function deposit() payable"
];

const VAULT_PRICE_ABI = [
  "function getMaxPrice(address) view returns (uint256)",
  "function getMinPrice(address) view returns (uint256)"
];

const VAULT_POOL_ABI = [
  "function poolAmounts(address) view returns (uint256)",
  "function reservedAmounts(address) view returns (uint256)",
  "function usdgAmounts(address) view returns (uint256)",
  "function guaranteedUsd(address) view returns (uint256)",
  "function feeReserves(address) view returns (uint256)"
];

// ── Lifecycle helper ABIs ─────────────────────────────────────────────────
const DATASTORE_LIFECYCLE_ABI = [
  "function getBytes32Count(bytes32 key) view returns (uint256)",
  "function getBytes32ValuesAt(bytes32 key, uint256 start, uint256 end) view returns (bytes32[])",
  "function getBytes32(bytes32 key) view returns (bytes32)",
  "function getUint(bytes32 key) view returns (uint256)",
  "function getAddress(bytes32 key) view returns (address)"
];

// ExchangeRouter functions not present in the IExchangeRouter typechain
const LIFECYCLE_ROUTER_ABI = [
  "function sendWnt(address receiver, uint256 amount) payable",
  "function sendTokens(address token, address receiver, uint256 amount) payable",
  "function multicall(bytes[] data) payable returns (bytes[])",
  "function cancelOrder(bytes32 key)",
  "function cancelDeposit(bytes32 key)",
  "function cancelWithdrawal(bytes32 key)",
  "function createDeposit(((address receiver, address callbackContract, address uiFeeReceiver, address market, address initialLongToken, address initialShortToken, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minMarketTokens, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)",
  "function createWithdrawal(((address receiver, address callbackContract, address uiFeeReceiver, address market, address[] longTokenSwapPath, address[] shortTokenSwapPath) addresses, uint256 minLongTokenAmount, uint256 minShortTokenAmount, bool shouldUnwrapNativeToken, uint256 executionFee, uint256 callbackGasLimit, bytes32[] dataList) params) payable returns (bytes32)"
];

const ORDER_HANDLER_EXECUTE_ABI = [
  "function executeOrder(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams) external"
];

const WITHDRAWAL_HANDLER_EXECUTE_ABI = [
  "function executeWithdrawal(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams) external"
];

const DEPOSIT_HANDLER_EXECUTE_ABI = [
  "function executeDeposit(bytes32 key, (address[] tokens, address[] providers, bytes[] data) oracleParams) external"
];

const ROLE_STORE_QUERY_ABI = [
  "function getRoleMembers(bytes32 roleKey, uint256 start, uint256 end) view returns (address[])"
];

const CHAINLINK_DSP_ABI = [
  "function verifier() view returns (address)"
];

const CHAINLINK_PRICE_FEED_PROVIDER_ABI = [
  "function getOraclePrice(address token, bytes data) view returns ((address token,uint256 min,uint256 max,uint256 timestamp,address provider))"
];

export type PositionDescriptor = {
  collateralToken: string;
  indexToken: string;
  isLong: boolean;
};

export type ActionType =
  | "deposit"
  | "openLong"
  | "openShort"
  | "increasePosition"
  | "decreasePosition"
  | "liquidate"
  | "withdraw";

export type ActionInput = {
  type: ActionType;
  token?: string;
  amountUsd?: bigint;
  collateralUsd?: bigint;
  leverageBps?: number;
  closeBps?: number;
  position?: PositionDescriptor;
  user?: string;
};

export type PoolTokenState = {
  token: string;
  symbol: string;
  decimals: number;
  poolAmount: bigint;
  reservedAmount: bigint;
  usdgAmount: bigint;
  guaranteedUsd: bigint;
  feeReserve: bigint;
  vaultBalance: bigint;
  maxPrice: bigint;
  minPrice: bigint;
};

export type PoolState = {
  tokens: PoolTokenState[];
  blockNumber: number;
};

export type PositionSnapshot = {
  size: bigint;
  collateral: bigint;
  averagePrice: bigint;
  reserveAmount: bigint;
};

export interface ActionAdapter {
  deposit(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  openLong(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  openShort(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  increasePosition(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  decreasePosition(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  liquidate(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
  withdraw(ctx: GMXInvariantContext, input: ActionInput): Promise<void>;
}

export type GMXInvariantContext = {
  vault: Contract;
  exchangeRouter: Contract;
  users: string[];
  signer: Signer;
  market: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  collateralToken: string;
  collateralDecimals: number;
  collateralUsdPerToken: bigint;
  whale?: string;
  trackedTokens: string[];
  trackedPositions: PositionDescriptor[];
  adapter: ActionAdapter;
  userNetDepositsUsd: Map<string, bigint>;
  actionTrace: ActionInput[];
};

export type MarketSet = {
  name: string;
  market: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  collateralToken: string;
  collateralDecimals: number;
  collateralUsdPerToken: bigint;
  whale?: string;
};

export type AdapterMode = "auto" | "real" | "noop";

export enum AdversarialActionType {
  OPEN_LONG = "OPEN_LONG",
  OPEN_SHORT = "OPEN_SHORT",
  PARTIAL_CLOSE = "PARTIAL_CLOSE",
  FULL_CLOSE = "FULL_CLOSE",
  WITHDRAW_COLLATERAL = "WITHDRAW_COLLATERAL",
  INCREASE_COLLATERAL = "INCREASE_COLLATERAL",
  LIQUIDATE = "LIQUIDATE",
  CLAIM_FUNDING_FEES = "CLAIM_FUNDING_FEES",
  MINE_BLOCKS = "MINE_BLOCKS",
  /** Close position requesting the long token as output (DecreasePositionSwapType = 1) */
  CLOSE_LONG_TOKEN_OUTPUT = "CLOSE_LONG_TOKEN_OUTPUT",
  /** Close position requesting the short token as output (DecreasePositionSwapType = 2) */
  CLOSE_SHORT_TOKEN_OUTPUT = "CLOSE_SHORT_TOKEN_OUTPUT"
}

export async function fundFreshSigner(nativeAmount: bigint = ethers.parseEther("5")): Promise<Signer> {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;

  await network.provider.send("hardhat_setBalance", [address, ethers.toBeHex(nativeAmount)]);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });

  return ethers.getSigner(address);
}

type MulticallLeg = {
  name: string;
  data: string;
  value?: bigint;
};

async function debugMulticallLegs(exchangeRouter: Contract, signer: Signer, legs: MulticallLeg[]): Promise<void> {
  const to = await exchangeRouter.getAddress();
  const signerAddress = await signer.getAddress();

  for (const leg of legs) {
    console.log(`\n[real-mutation-debug] Testing leg: ${leg.name}`);
    try {
      await signer.call({
        to,
        data: leg.data,
        value: leg.value || 0n
      });
      console.log(`[real-mutation-debug] ${leg.name}: call simulation OK`);
    } catch (error) {
      const e = error as any;
      const rawData =
        e?.data ||
        e?.error?.data ||
        e?.info?.error?.data ||
        e?.info?.result ||
        "";
      const selector = typeof rawData === "string" && rawData.startsWith("0x") ? rawData.slice(0, 10) : "n/a";

      console.log(`[real-mutation-debug] ${leg.name}: REVERTS`);
      console.log(`[real-mutation-debug] signer: ${signerAddress}`);
      console.log(`[real-mutation-debug] selector: ${selector}`);

      if (typeof rawData === "string" && rawData.length > 2) {
        console.log(`[real-mutation-debug] data: ${rawData}`);
        try {
          const decoded = exchangeRouter.interface.parseError(rawData);
          if (decoded) {
            console.log(`[real-mutation-debug] decoded: ${decoded.name}(${decoded.args.map((a: unknown) => String(a)).join(",")})`);
          }
        } catch {
          // Keep raw selector/data when ABI cannot decode nested custom errors.
        }
      }

      if (e?.reason) {
        console.log(`[real-mutation-debug] reason: ${String(e.reason)}`);
      }
      if (e?.shortMessage) {
        console.log(`[real-mutation-debug] shortMessage: ${String(e.shortMessage)}`);
      }
      if (e?.message) {
        console.log(`[real-mutation-debug] message: ${String(e.message)}`);
      }
    }
  }
}

const REAL_MUTATIONS_ENABLED = isRealMutationsEnabled();
export const FUZZ_PROFILE = process.env.GMX_FUZZ_PROFILE ?? "fast";
export const FUZZ_CONFIG = {
  runs: FUZZ_PROFILE === "stress" ? 12 : 8,
  maxCollateralUsd: FUZZ_PROFILE === "stress" ? 2_500n : 1_000n,
  maxIncreaseCollateralUsd: FUZZ_PROFILE === "stress" ? 1_500n : 500n,
  maxWithdrawUsd: FUZZ_PROFILE === "stress" ? 1_000n : 500n,
  maxLeverageBps: FUZZ_PROFILE === "stress" ? 60_000 : 50_000,
  timeoutMs: FUZZ_PROFILE === "stress" ? 600_000 : 180_000
} as const;
const DEBUG_REAL_MUTATIONS = process.env.GMX_DEBUG_MULTICALL === "1";
const DEFAULT_VAULT = DEFAULT_DEPLOYED.vault;
const DEFAULT_EXCHANGE_ROUTER = DEFAULT_DEPLOYED.exchangeRouter;
const DEFAULT_MARKET = DEFAULT_DEPLOYED.market;
const DEFAULT_WHALE = process.env.GMX_WHALE_ADDRESS || DEFAULT_DEPLOYED.impersonationWhale;
const DEFAULT_COLLATERAL_TOKEN = DEFAULT_DEPLOYED.collateralToken;
const DEFAULT_EXECUTION_FEE =
  process.env.GMX_EXECUTION_FEE_WEI ||
  (getActiveChain() === "avalanche" ? "500000000000000" : "100000000000000");
const DEFAULT_FORK_BLOCK = process.env.FORK_BLOCK || "unknown";
const MINIMUM_VIABLE_FORK_BLOCK = 403540360;
const DEFAULT_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const DEFAULT_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const DEFAULT_COLLATERAL_DECIMALS = Number(process.env.GMX_COLLATERAL_DECIMALS || "6");
const DEFAULT_WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const DEFAULT_BTC_INDEX_TOKEN = "0x47904963fc8b2340414262125aF798B9655E58Cd";
const DEFAULT_WBTC_USDC_MARKET = "0x47c031236e19d024b42f8AE6780E44A573170703";
const DEFAULT_ARB = "0x912CE59144191C1204E64559FE8253a0e49E6548";
const DEFAULT_ARB_USDC_MARKET = "0xC25cEf6061Cf5dE5eb761b50E4743c1F5D7E5407";
const DEFAULT_WETH_USD_PRICE = BigInt(process.env.GMX_WETH_USD_PRICE || "2000");
const DEFAULT_WBTC_USD_PRICE = BigInt(process.env.GMX_WBTC_USD_PRICE || "85000");
const DEFAULT_ARB_USD_PRICE = BigInt(process.env.GMX_ARB_USD_PRICE || "2");
const DEFAULT_STABLE_USD_PRICE = 1n;
const MIN_AVAX_EXECUTION_FEE = ethers.parseEther(process.env.GMX_MIN_EXECUTION_FEE_AVAX || "0.05");
const DEFAULT_WETH_WHALE = process.env.GMX_WETH_WHALE;
const DEFAULT_WBTC_WHALE = process.env.GMX_WBTC_WHALE;

function normalizeExecutionFee(fee: bigint): bigint {
  if (getActiveChain() !== "avalanche") {
    return fee;
  }
  return fee < MIN_AVAX_EXECUTION_FEE ? MIN_AVAX_EXECUTION_FEE : fee;
}

function getActiveChain(): "arbitrum" | "avalanche" {
  return (process.env.GMX_CHAIN || "arbitrum").toLowerCase() === "avalanche"
    ? "avalanche"
    : "arbitrum";
}

function readDeploymentAddress(fileName: string): string | undefined {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", getActiveChain(), fileName);
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof payload.address === "string" && payload.address.length > 0) {
      return payload.address;
    }
  } catch {
    // Fallback to env when deployment files are unavailable.
  }
  return undefined;
}

let directRpcProvider: JsonRpcProvider | undefined;
let directRpcProviderCleanupHookInstalled = false;

export async function shutdownDirectRpcProvider(): Promise<void> {
  if (!directRpcProvider) {
    return;
  }

  try {
    directRpcProvider.removeAllListeners();
    await directRpcProvider.destroy();
  } catch {
    // Best-effort teardown; test logic should not fail on provider cleanup.
  } finally {
    directRpcProvider = undefined;
  }
}

export function isRealMutationsEnabled(): boolean {
  const value = (process.env.GMX_ENABLE_REAL_MUTATIONS || "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export function requireRealMutations(specName: string): void {
  if (!isRealMutationsEnabled()) {
    throw new Error(
      `[${specName}] requires explicit real mutations. Run with GMX_ENABLE_REAL_MUTATIONS=true.`
    );
  }
}

export function getForkBlockNumber(): number {
  const activeChain = getActiveChain();
  const raw =
    activeChain === "avalanche"
      ? process.env.AVALANCHE_FORK_BLOCK_NUMBER || process.env.AVALANCHE_FORK_BLOCK || process.env.FORK_BLOCK_NUMBER || process.env.FORK_BLOCK
      : process.env.FORK_BLOCK_NUMBER || process.env.FORK_BLOCK;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Fork block env must be set to a positive integer for direct fork-block reads");
  }
  return parsed;
}

export function getDirectRpcProvider(): JsonRpcProvider {
  if (!directRpcProvider) {
    const activeChain = getActiveChain();
    const url =
      activeChain === "avalanche"
        ? process.env.AVALANCHE_RPC_URL || process.env.AVALANCHE_RPC
        : process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
    if (!url) {
      throw new Error("Chain RPC env must be configured for direct fork-block reads");
    }
    directRpcProvider = new JsonRpcProvider(url);
    if (!directRpcProviderCleanupHookInstalled) {
      directRpcProviderCleanupHookInstalled = true;
      process.once("exit", () => {
        void shutdownDirectRpcProvider();
      });
    }
  }
  return directRpcProvider;
}

export async function readAtForkBlock<T>(
  contractAddress: string,
  abi: readonly string[] | string[],
  fnName: string,
  args: readonly unknown[] = []
): Promise<T> {
  const contract = new RpcContract(contractAddress, abi, getDirectRpcProvider()) as any;
  return contract[fnName](...args, { blockTag: getForkBlockNumber() }) as Promise<T>;
}

export function biasedUsdAmount(seed: number, minUsd: bigint, maxUsd: bigint): bigint {
  if (maxUsd <= minUsd) {
    return minUsd;
  }

  const bucket = seed % 10;
  const range = maxUsd - minUsd;

  if (bucket < 7) {
    const nearMaxBps = 8_500n + BigInt(seed % 1_501); // 85.00% -> 100.00%
    const candidate = (maxUsd * nearMaxBps) / 10_000n;
    return candidate >= minUsd ? candidate : minUsd;
  }

  if (bucket < 9) {
    const candidate = minUsd + range / 20n;
    return candidate > 0n ? candidate : 1n;
  }

  return minUsd + range / 2n;
}

function isHistoricalHardforkLookupError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No known hardfork for execution on historical block");
}

export function biasedAccrualBlocks(seed: number): number {
  if (FUZZ_PROFILE === "stress") {
    return 50 + (seed % 451);
  }
  return 20 + (seed % 81);
}

export async function mineBlocksWithAccrual(blocks: number, secondsPerBlock = 1): Promise<void> {
  await network.provider.send("evm_increaseTime", [blocks * secondsPerBlock]);
  for (let i = 0; i < blocks; i++) {
    await network.provider.send("evm_mine");
  }
}

export async function withIterationSnapshot<T>(run: () => Promise<T>): Promise<T> {
  // Snapshot boundary must include all iteration setup (including any oracle mutation).
  const snapshotId = await network.provider.send("evm_snapshot", []);
  try {
    return await run();
  } finally {
    await network.provider.send("evm_revert", [snapshotId]);
  }
}

function toTokenUnits(amountUsd: bigint, decimals: number, usdPerToken: bigint): bigint {
  const scale = 10n ** BigInt(decimals);
  if (usdPerToken <= 0n) {
    throw new Error(`Invalid usdPerToken: ${usdPerToken.toString()}`);
  }
  const amount = (amountUsd * scale) / usdPerToken;
  return amount > 0n ? amount : 1n;
}

function getUsdPerToken(tokenAddress: string): bigint {
  const token = tokenAddress.toLowerCase();
  if (token === DEFAULT_WBTC.toLowerCase()) {
    return DEFAULT_WBTC_USD_PRICE;
  }
  if (token === DEFAULT_WETH.toLowerCase()) {
    return DEFAULT_WETH_USD_PRICE;
  }
  return DEFAULT_STABLE_USD_PRICE;
}

function getWhaleForToken(tokenAddress: string): string | undefined {
  const token = tokenAddress.toLowerCase();
  if (token === DEFAULT_WBTC.toLowerCase()) {
    return DEFAULT_WBTC_WHALE;
  }
  if (token === DEFAULT_WETH.toLowerCase()) {
    return DEFAULT_WETH_WHALE;
  }
  return DEFAULT_WHALE;
}
const DEFAULT_DEPOSIT_VAULT =
  readDeploymentAddress("DepositVault.json") ||
  process.env.GMX_DEPOSIT_VAULT_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_ROUTER =
  readDeploymentAddress("Router.json") ||
  process.env.GMX_ROUTER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_ORDER_VAULT =
  readDeploymentAddress("OrderVault.json") ||
  process.env.GMX_ORDER_VAULT_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_DATA_STORE =
  readDeploymentAddress("DataStore.json") ||
  process.env.GMX_DATA_STORE_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const ORDER_LIST_KEY = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["ORDER_LIST"]));
const DEPOSIT_LIST_KEY = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["DEPOSIT_LIST"]));
const WITHDRAWAL_LIST_KEY = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["WITHDRAWAL_LIST"]));
const IS_ADL_ENABLED_KEY = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["IS_ADL_ENABLED"]));

const DEFAULT_WITHDRAWAL_VAULT =
  readDeploymentAddress("WithdrawalVault.json") ||
  process.env.GMX_WITHDRAWAL_VAULT_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_ORDER_HANDLER =
  readDeploymentAddress("OrderHandler.json") ||
  process.env.GMX_ORDER_HANDLER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_WITHDRAWAL_HANDLER =
  readDeploymentAddress("WithdrawalHandler.json") ||
  process.env.GMX_WITHDRAWAL_HANDLER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_DEPOSIT_HANDLER =
  readDeploymentAddress("DepositHandler.json") ||
  process.env.GMX_DEPOSIT_HANDLER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_ROLE_STORE =
  readDeploymentAddress("RoleStore.json") ||
  process.env.GMX_ROLE_STORE_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_DATA_STREAM_PROVIDER =
  readDeploymentAddress("ChainlinkDataStreamProvider.json") ||
  process.env.GMX_CHAINLINK_DATA_STREAM_PROVIDER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_CHAINLINK_PRICE_FEED_PROVIDER =
  readDeploymentAddress("ChainlinkPriceFeedProvider.json") ||
  process.env.GMX_CHAINLINK_PRICE_FEED_PROVIDER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_EVENT_EMITTER =
  readDeploymentAddress("EventEmitter.json") ||
  process.env.GMX_EVENT_EMITTER_ADDRESS ||
  "0x0000000000000000000000000000000000000000";
const DEFAULT_KEEPER = process.env.GMX_KEEPER_ADDRESS || "";
const DEFAULT_TOKENS = getDefaultTrackedTokens();

const DEFAULT_POSITIONS: PositionDescriptor[] = [
  {
    collateralToken: DEFAULT_TOKENS[0],
    indexToken: DEFAULT_TOKENS[1],
    isLong: true
  },
  {
    collateralToken: DEFAULT_TOKENS[0],
    indexToken: DEFAULT_TOKENS[1],
    isLong: false
  }
];

const PRIMARY_MARKET_SET: MarketSet = {
  name: "WETH/USDC",
  market: DEFAULT_MARKET,
  indexToken: process.env.GMX_MARKET_INDEX_TOKEN || DEFAULT_WETH,
  longToken: process.env.GMX_MARKET_LONG_TOKEN || DEFAULT_WETH,
  shortToken: process.env.GMX_MARKET_SHORT_TOKEN || DEFAULT_USDC,
  collateralToken: process.env.GMX_COLLATERAL_TOKEN || DEFAULT_COLLATERAL_TOKEN || DEFAULT_USDC,
  collateralDecimals: DEFAULT_COLLATERAL_DECIMALS,
  collateralUsdPerToken: BigInt(process.env.GMX_COLLATERAL_USD_PER_TOKEN || "1"),
  whale: process.env.GMX_COLLATERAL_WHALE || getWhaleForToken(process.env.GMX_COLLATERAL_TOKEN || DEFAULT_COLLATERAL_TOKEN || DEFAULT_USDC)
};

const SECONDARY_MARKET_SET: MarketSet = {
  name: process.env.GMX_MARKET_2_NAME || "WBTC/USDC",
  market: process.env.GMX_MARKET_2_ADDRESS || DEFAULT_WBTC_USDC_MARKET,
  indexToken: process.env.GMX_MARKET_2_INDEX_TOKEN || DEFAULT_BTC_INDEX_TOKEN,
  longToken: process.env.GMX_MARKET_2_LONG_TOKEN || DEFAULT_WBTC,
  shortToken: process.env.GMX_MARKET_2_SHORT_TOKEN || DEFAULT_USDC,
  collateralToken: process.env.GMX_MARKET_2_COLLATERAL_TOKEN || DEFAULT_WBTC,
  collateralDecimals: Number(process.env.GMX_MARKET_2_COLLATERAL_DECIMALS || "8"),
  collateralUsdPerToken: BigInt(process.env.GMX_MARKET_2_COLLATERAL_USD_PER_TOKEN || DEFAULT_WBTC_USD_PRICE.toString()),
  whale: process.env.GMX_MARKET_2_WHALE || getWhaleForToken(process.env.GMX_MARKET_2_COLLATERAL_TOKEN || DEFAULT_WBTC)
};

const TERTIARY_MARKET_SET: MarketSet = {
  name: process.env.GMX_MARKET_3_NAME || "ARB/USDC",
  market: process.env.GMX_MARKET_3_ADDRESS || DEFAULT_ARB_USDC_MARKET,
  indexToken: process.env.GMX_MARKET_3_INDEX_TOKEN || DEFAULT_ARB,
  longToken: process.env.GMX_MARKET_3_LONG_TOKEN || DEFAULT_ARB,
  shortToken: process.env.GMX_MARKET_3_SHORT_TOKEN || DEFAULT_USDC,
  collateralToken: process.env.GMX_MARKET_3_COLLATERAL_TOKEN || DEFAULT_ARB,
  collateralDecimals: Number(process.env.GMX_MARKET_3_COLLATERAL_DECIMALS || "18"),
  collateralUsdPerToken: BigInt(process.env.GMX_MARKET_3_COLLATERAL_USD_PER_TOKEN || DEFAULT_ARB_USD_PRICE.toString()),
  whale: process.env.GMX_MARKET_3_WHALE || process.env.GMX_MARKET_3_ADDRESS || DEFAULT_ARB_USDC_MARKET
};

// Avalanche C-chain token addresses (mainnet, chainId 43114)
const AVA_WAVAX   = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
const AVA_WETH    = "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab"; // WETH.e
const AVA_WBTC_E  = "0x50b7545627a5162f82a992c33b87adc75187b218"; // WBTC.e
const AVA_USDC_E  = "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664"; // USDC.e
const AVA_WAVAX_USD_PRICE = BigInt(process.env.GMX_WAVAX_USD_PRICE || "25");

function getDefaultTrackedTokens(): string[] {
  if (process.env.GMX_TRACKED_TOKENS) {
    return process.env.GMX_TRACKED_TOKENS
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (getActiveChain() === "avalanche") {
    return [
      "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664", // USDC.e
      "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", // WAVAX
      "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab", // WETH.e
      "0x50b7545627a5162f82a992c33b87adc75187b218" // WBTC.e
    ];
  }

  return [
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC.e
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
    "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" // WBTC
  ];
}

const AVA_WAVAX_MARKET_SET: MarketSet = {
  name: "WAVAX/USDC",
  market: process.env.GMX_MARKET_AVA_1_ADDRESS || "0x913C1F46b48b3eD35E7dc3Cf754d4ae8499F31CF",
  indexToken: AVA_WAVAX,
  longToken: AVA_WAVAX,
  shortToken: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  collateralToken: AVA_WAVAX,
  collateralDecimals: 18,
  collateralUsdPerToken: AVA_WAVAX_USD_PRICE,
  whale: process.env.GMX_MARKET_AVA_1_WHALE,
};

export const MARKET_SETS: readonly MarketSet[] =
  getActiveChain() === "avalanche"
    ? [AVA_WAVAX_MARKET_SET].filter(
        (item) => item.market !== "0x0000000000000000000000000000000000000000"
      )
    : [PRIMARY_MARKET_SET, SECONDARY_MARKET_SET, TERTIARY_MARKET_SET].filter(
        (item) => item.market !== "0x0000000000000000000000000000000000000000"
      );

export type DetectorSnapshot = {
  label: string;
  userBalances: Record<string, bigint>;
  poolAmounts: Record<string, bigint>;
  positionSize: bigint;
  positionCollateral: bigint;
  feesCollected: bigint;
};

export type ExploitSequenceItem = {
  action: string;
  params: Record<string, unknown>;
  txHash?: string;
  blockNumber?: number;
};

export class ExploitDetector {
  private readonly model = new GMXAccountingModel();
  private readonly snapshots: DetectorSnapshot[] = [];
  private readonly sequence: ExploitSequenceItem[] = [];
  private readonly events: Array<Record<string, unknown>> = [];

  constructor(
    private readonly market: string,
    private readonly userDeposits: Record<string, bigint> = {}
  ) {}

  snapshot(label: string, ctx: Omit<DetectorSnapshot, "label">): void {
    this.snapshots.push({ label, ...ctx });
  }

  recordAction(item: ExploitSequenceItem): void {
    this.sequence.push(item);
  }

  recordEvent(event: Record<string, unknown>): void {
    this.events.push(event);
  }

  private get first(): DetectorSnapshot {
    if (this.snapshots.length === 0) {
      throw new Error("ExploitDetector has no snapshots");
    }
    return this.snapshots[0];
  }

  private get last(): DetectorSnapshot {
    if (this.snapshots.length === 0) {
      throw new Error("ExploitDetector has no snapshots");
    }
    return this.snapshots[this.snapshots.length - 1];
  }

  assertNoTheft(label: string): void {
    const before = this.first;
    const after = this.last;
    for (const token of Object.keys(after.userBalances)) {
      const start = before.userBalances[token] || 0n;
      const end = after.userBalances[token] || 0n;
      const deposits = this.userDeposits[token] || 0n;
      if (end > start + deposits) {
        this.exportProof(`${label}-assertNoTheft`);
        throw new Error(`NoTheft violation on ${token}: end=${end} start=${start} deposits=${deposits}`);
      }
    }
  }

  assertPoolMonotonic(label: string): void {
    const before = this.first;
    const after = this.last;
    for (const token of Object.keys(after.poolAmounts)) {
      const start = before.poolAmounts[token] || 0n;
      const end = after.poolAmounts[token] || 0n;
      const maxAllowedDrop = (after.feesCollected - before.feesCollected) + 1n;
      if (end + maxAllowedDrop < start) {
        this.exportProof(`${label}-assertPoolMonotonic`);
        throw new Error(`PoolMonotonic violation on ${token}: start=${start} end=${end} allowance=${maxAllowedDrop}`);
      }
    }
  }

  assertNoFeeMismatch(label: string): void {
    const before = this.first;
    const after = this.last;
    const actual = (before.positionCollateral - after.positionCollateral) - (after.feesCollected - before.feesCollected);
    const expected = this.model.expectedCollateralAfterOpen(before.positionCollateral, 10n);
    const kind = this.model.classifyDivergence(actual, expected, 1n);
    if (kind === "mismatch") {
      this.exportProof(`${label}-assertNoFeeMismatch`);
      throw new Error(`Fee mismatch: actual=${actual} expected=${expected}`);
    }
  }

  assertLiquidationClean(label: string): void {
    const before = this.first;
    const after = this.last;
    const hasResidualPosition = after.positionSize > 0n || after.positionCollateral > 0n;
    const pooledBefore = Object.values(before.poolAmounts).reduce((acc, v) => acc + v, 0n);
    const pooledAfter = Object.values(after.poolAmounts).reduce((acc, v) => acc + v, 0n);
    if (hasResidualPosition || pooledAfter < pooledBefore) {
      this.exportProof(`${label}-assertLiquidationClean`);
      throw new Error(
        `Liquidation clean violation: size=${after.positionSize} collateral=${after.positionCollateral} poolBefore=${pooledBefore} poolAfter=${pooledAfter}`
      );
    }
  }

  exportProof(label: string): void {
    const proofDir = path.join(process.cwd(), "exploit-proofs");
    fs.mkdirSync(proofDir, { recursive: true });
    const before = this.first;
    const after = this.last;
    const beforeSum = Object.values(before.poolAmounts).reduce((acc, v) => acc + v, 0n);
    const afterSum = Object.values(after.poolAmounts).reduce((acc, v) => acc + v, 0n);
    const payload = {
      timestamp: new Date().toISOString(),
      forkBlock: Number(process.env.FORK_BLOCK || 0),
      market: this.market,
      detector: label,
      sequence: this.sequence,
      beforeState: {
        userBalances: before.userBalances,
        poolAmounts: before.poolAmounts
      },
      afterState: {
        userBalances: after.userBalances,
        poolAmounts: after.poolAmounts
      },
      delta: {
        userNet: Object.values(after.userBalances).reduce((acc, v) => acc + v, 0n).toString(),
        poolNet: (afterSum - beforeSum).toString()
      },
      events: this.events,
      reproCommand: `npm run test:gmx-exploit-search -- --grep "${label}"`,
      envVars: {
        FORK_BLOCK: process.env.FORK_BLOCK,
        GMX_ENABLE_REAL_MUTATIONS: process.env.GMX_ENABLE_REAL_MUTATIONS,
        GMX_FUZZ_PROFILE: process.env.GMX_FUZZ_PROFILE
      }
    };
    const proofPath = path.join(proofDir, `${label}-${Date.now()}.json`);
    fs.writeFileSync(proofPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

export async function fundMarketSigner(
  marketSet: MarketSet,
  targetUsd: bigint = FUZZ_CONFIG.maxCollateralUsd
): Promise<Signer> {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;

  await network.provider.send("hardhat_setBalance", [address, ethers.toBeHex(ethers.parseEther("100"))]);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });

  const requestedToken = toTokenUnits(targetUsd, marketSet.collateralDecimals, marketSet.collateralUsdPerToken);

  const tryWrapNativeCollateral = async (): Promise<boolean> => {
    try {
      const signer = await ethers.getSigner(address);
      const wrapped = await ethers.getContractAt(WRAPPED_NATIVE_ABI, marketSet.collateralToken, signer);
      const nativeAmount = requestedToken > ethers.parseEther("50") ? ethers.parseEther("50") : requestedToken;
      if (nativeAmount <= 0n) {
        return false;
      }
      await (await (wrapped as any).deposit({ value: nativeAmount })).wait();
      return true;
    } catch {
      return false;
    }
  };

  const whaleAddress = marketSet.whale || getWhaleForToken(marketSet.collateralToken);
  if (!whaleAddress && (await tryWrapNativeCollateral())) {
    return ethers.getSigner(address);
  }
  if (!whaleAddress) {
    throw new Error(`No whale configured for ${marketSet.name} collateral ${marketSet.collateralToken}`);
  }

  await network.provider.request({ method: "hardhat_impersonateAccount", params: [whaleAddress] });
  try {
    await network.provider.send("hardhat_setBalance", [whaleAddress, ethers.toBeHex(ethers.parseEther("10"))]);

    const whaleSigner = await ethers.getSigner(whaleAddress);
    const token = await ethers.getContractAt(ERC20_ABI, marketSet.collateralToken);
    const whaleToken = token.connect(whaleSigner) as any;

    try {
      await (await whaleToken.transfer(address, requestedToken)).wait();
    } catch {
      // Fallback keeps setup robust when whale liquidity is lower than the target budget.
      try {
        await (await whaleToken.transfer(address, 1n)).wait();
      } catch {
        if (!(await tryWrapNativeCollateral())) {
          throw new Error(
            `Unable to fund signer for ${marketSet.name}; whale ${whaleAddress} has no transferable balance and wrapped-native fallback failed`
          );
        }
      }
    }
  } finally {
    await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [whaleAddress] });
  }

  return ethers.getSigner(address);
}

class NoopActionAdapter implements ActionAdapter {
  private async checkpoint(): Promise<void> {
    await network.provider.send("evm_mine");
  }

  async deposit(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async openLong(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async openShort(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async increasePosition(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async decreasePosition(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async liquidate(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }

  async withdraw(_ctx: GMXInvariantContext, _input: ActionInput): Promise<void> {
    await this.checkpoint();
  }
}

class RealForkActionAdapter extends NoopActionAdapter {
  private exchangeRouterCodeVerified = false;

  private async ensureLocalFork(): Promise<void> {
    const chainIdHex = await network.provider.send("eth_chainId");
    const chainId = Number.parseInt(chainIdHex, 16);
    if (chainId !== 31337) {
      throw new Error("Real mutation adapter only supports local Hardhat fork (chainId 31337)");
    }
  }

  private tokenAmountFromUsd(ctx: GMXInvariantContext, _tokenAddress: string, amountUsd: bigint): bigint {
    return toTokenUnits(amountUsd, ctx.collateralDecimals, ctx.collateralUsdPerToken);
  }

  private async ensureRouterAddresses(): Promise<void> {
    if (DEFAULT_ROUTER === "0x0000000000000000000000000000000000000000") {
      throw new Error("GMX_ROUTER_ADDRESS is required when Router deployment artifact is unavailable");
    }
    if (DEFAULT_EXCHANGE_ROUTER === "0x0000000000000000000000000000000000000000") {
      throw new Error("GMX_EXCHANGE_ROUTER_ADDRESS is required for real mutation adapter");
    }
    if (DEFAULT_DEPOSIT_VAULT === "0x0000000000000000000000000000000000000000") {
      throw new Error("GMX_DEPOSIT_VAULT_ADDRESS is required when DepositVault deployment artifact is unavailable");
    }
    if (DEFAULT_ORDER_VAULT === "0x0000000000000000000000000000000000000000") {
      throw new Error("GMX_ORDER_VAULT_ADDRESS is required when OrderVault deployment artifact is unavailable");
    }

    if (!this.exchangeRouterCodeVerified) {
      const code = await ethers.provider.getCode(DEFAULT_EXCHANGE_ROUTER);
      if (code === "0x") {
        throw new Error(
          `ExchangeRouter ${DEFAULT_EXCHANGE_ROUTER} has no code at fork block ${DEFAULT_FORK_BLOCK}. Minimum viable: ${MINIMUM_VIABLE_FORK_BLOCK}. Update .env.`
        );
      }
      console.log(`[setup] ExchangeRouter code verified at fork block ${DEFAULT_FORK_BLOCK}`);
      this.exchangeRouterCodeVerified = true;
    }
  }

  private async fundSignerFromWhale(
    ctx: GMXInvariantContext,
    signerAddress: string,
    tokenAddress: string,
    amountToken: bigint
  ): Promise<void> {
    const chain = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();
    const tokenLc = tokenAddress.toLowerCase();

    if (chain === "avalanche" && tokenLc === "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7") {
      await network.provider.send("hardhat_setBalance", [signerAddress, "0x56BC75E2D63100000"]);
      const signer = await ethers.getSigner(signerAddress);
      const wrapped = await ethers.getContractAt(WRAPPED_NATIVE_ABI, tokenAddress, signer);
      const current = BigInt((await (wrapped as any).balanceOf(signerAddress)).toString());
      if (current < amountToken) {
        const toMint = ((amountToken - current) * 11n) / 10n;
        await (await (wrapped as any).deposit({ value: toMint })).wait();
      }
      return;
    }

    if (chain === "avalanche" && tokenLc === "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664") {
      const whale = "0x625E7708f30cA75bfd92586e17077590C60eb4cD";
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [whale] });
      try {
        await network.provider.send("hardhat_setBalance", [whale, "0x56BC75E2D63100000"]);
        const whaleSigner = await ethers.getSigner(whale);
        const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
        const whaleToken = token.connect(whaleSigner) as any;
        const transferAmount = (amountToken * 11n) / 10n;
        await whaleToken.transfer(signerAddress, transferAmount);
      } finally {
        await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [whale] });
      }
      return;
    }

    const whaleAddress = ctx.whale || getWhaleForToken(tokenAddress);
    if (!whaleAddress) {
      throw new Error(`No whale configured for token ${tokenAddress}`);
    }

    await network.provider.request({ method: "hardhat_impersonateAccount", params: [whaleAddress] });
    try {
      await network.provider.send("hardhat_setBalance", [whaleAddress, "0x56BC75E2D63100000"]);
      await network.provider.send("hardhat_setBalance", [signerAddress, "0x56BC75E2D63100000"]);

      const whaleSigner = await ethers.getSigner(whaleAddress);
      const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
      const whaleToken = token.connect(whaleSigner) as any;
      await whaleToken.transfer(signerAddress, amountToken);
    } finally {
      await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [whaleAddress] });
    }
  }

  async deposit(ctx: GMXInvariantContext, input: ActionInput): Promise<void> {
    await this.ensureLocalFork();

    if (ctx.market === "0x0000000000000000000000000000000000000000") {
      throw new Error("Market address is required for real mutation adapter");
    }
    await this.ensureRouterAddresses();

    const signerAddress = input.user || ctx.users[0];
    const signer = await ethers.getSigner(signerAddress);
    const tokenAddress = input.token || ctx.collateralToken || DEFAULT_COLLATERAL_TOKEN || ctx.trackedTokens[0];
    const amountUsd = input.amountUsd || input.collateralUsd || 0n;
    const amountToken = this.tokenAmountFromUsd(ctx, tokenAddress, amountUsd);
    if (amountToken <= 0n) {
      await network.provider.send("evm_mine");
      return;
    }

    await this.fundSignerFromWhale(ctx, signerAddress, tokenAddress, amountToken);

    const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
    const executionFee = BigInt(DEFAULT_EXECUTION_FEE);
    const router = ctx.exchangeRouter.connect(signer) as any;

    const signerToken = token.connect(signer) as any;
    await signerToken.approve(DEFAULT_ROUTER, amountToken);

    const depositParams = {
      addresses: {
        receiver: signerAddress,
        callbackContract: ethers.ZeroAddress,
        uiFeeReceiver: ethers.ZeroAddress,
        market: ctx.market,
        initialLongToken: ctx.longToken,
        initialShortToken: ctx.shortToken,
        longTokenSwapPath: [],
        shortTokenSwapPath: []
      },
      minMarketTokens: 0,
      shouldUnwrapNativeToken: false,
      executionFee,
      callbackGasLimit: 0,
      dataList: []
    };

    const sendWntData = router.interface.encodeFunctionData("sendWnt", [DEFAULT_DEPOSIT_VAULT, executionFee]);
    const sendTokensData = router.interface.encodeFunctionData("sendTokens", [
      tokenAddress,
      DEFAULT_DEPOSIT_VAULT,
      amountToken
    ]);
    const createDepositData = router.interface.encodeFunctionData("createDeposit", [depositParams]);
    const calls = [sendWntData, sendTokensData, createDepositData];

    const depositVaultUsdcBefore = DEBUG_REAL_MUTATIONS
      ? await (token as any).balanceOf(DEFAULT_DEPOSIT_VAULT)
      : 0n;

    if (DEBUG_REAL_MUTATIONS) {
      console.log(`[proof-A deposit] exchangeRouter: ${await ctx.exchangeRouter.getAddress()}`);
      console.log(`[proof-A deposit] calls.length: ${calls.length}`);
    }

    if (DEBUG_REAL_MUTATIONS) {
      await debugMulticallLegs(router, signer, [
        { name: "sendWnt", data: sendWntData, value: executionFee },
        { name: "sendTokens", data: sendTokensData, value: 0n },
        { name: "createDeposit", data: createDepositData, value: 0n }
      ]);
    }

    const tx = await router.multicall(calls, {
      value: executionFee,
      gasLimit: 3_000_000
    });

    if (DEBUG_REAL_MUTATIONS) {
      console.log(`[proof-A deposit] tx.to: ${tx.to}`);
      console.log(`[proof-A deposit] tx.data[0:10]: ${tx.data?.slice(0, 10)}`);
    }

    const receipt = await tx.wait();
    if (DEBUG_REAL_MUTATIONS) {
      const depositVaultUsdcAfter = await (token as any).balanceOf(DEFAULT_DEPOSIT_VAULT);
      console.log(
        `[proof-B deposit] DepositVault USDC before: ${depositVaultUsdcBefore.toString()}  after: ${depositVaultUsdcAfter.toString()}`
      );

      console.log(
        `Deposit tx: ${receipt.hash} status=${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed.toString()} logs=${receipt.logs.length}`
      );
      if (receipt.logs.length > 0) {
        for (const [idx, log] of receipt.logs.slice(0, 5).entries()) {
          const topic0 = log.topics && log.topics.length > 0 ? log.topics[0] : "none";
          console.log(`Deposit log[${idx}] topic0=${topic0}`);
        }
      }
    }
  }

  async openLong(ctx: GMXInvariantContext, input: ActionInput): Promise<void> {
    await this.ensureLocalFork();

    if (ctx.market === "0x0000000000000000000000000000000000000000") {
      throw new Error("Market address is required for real mutation adapter");
    }
    await this.ensureRouterAddresses();

    const signerAddress = input.user || ctx.users[0];
    const signer = await ethers.getSigner(signerAddress);
    const tokenAddress = input.token || ctx.collateralToken || DEFAULT_COLLATERAL_TOKEN || ctx.trackedTokens[0];

    const collateralUsd = input.collateralUsd || input.amountUsd || 500n;
    const leverageBps = BigInt(input.leverageBps || 20_000);
    const collateralAmount = this.tokenAmountFromUsd(ctx, tokenAddress, collateralUsd);
    const sizeDeltaUsd = ((collateralUsd * leverageBps) / 10_000n) * 10n ** 30n;

    if (collateralAmount <= 0n || sizeDeltaUsd <= 0n) {
      await network.provider.send("evm_mine");
      return;
    }

    await this.fundSignerFromWhale(ctx, signerAddress, tokenAddress, collateralAmount);
    const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
    await (token.connect(signer) as any).approve(DEFAULT_ROUTER, collateralAmount);

    const executionFee = BigInt(DEFAULT_EXECUTION_FEE);
    const router = ctx.exchangeRouter.connect(signer) as any;
    const orderParams = {
      addresses: {
        receiver: signerAddress,
        cancellationReceiver: signerAddress,
        callbackContract: ethers.ZeroAddress,
        uiFeeReceiver: ethers.ZeroAddress,
        market: ctx.market,
        initialCollateralToken: tokenAddress,
        swapPath: []
      },
      numbers: {
        sizeDeltaUsd,
        initialCollateralDeltaAmount: collateralAmount,
        triggerPrice: 0,
        acceptablePrice: ethers.MaxUint256,
        executionFee,
        callbackGasLimit: 0,
        minOutputAmount: 0,
        validFromTime: 0
      },
      orderType: 2,
      decreasePositionSwapType: 0,
      isLong: true,
      shouldUnwrapNativeToken: false,
      autoCancel: false,
      referralCode: ethers.ZeroHash,
      dataList: []
    };

    const sendWntData = router.interface.encodeFunctionData("sendWnt", [DEFAULT_ORDER_VAULT, executionFee]);
    const sendTokensData = router.interface.encodeFunctionData("sendTokens", [
      tokenAddress,
      DEFAULT_ORDER_VAULT,
      collateralAmount
    ]);
    const createOrderData = router.interface.encodeFunctionData("createOrder", [orderParams]);
    const calls = [sendWntData, sendTokensData, createOrderData];

    const dataStore =
      DEFAULT_DATA_STORE !== "0x0000000000000000000000000000000000000000"
        ? await ethers.getContractAt(["function getBytes32Count(bytes32 key) view returns (uint256)"], DEFAULT_DATA_STORE)
        : undefined;
    const orderCountBefore = DEBUG_REAL_MUTATIONS && dataStore ? await (dataStore as any).getBytes32Count(ORDER_LIST_KEY) : 0n;

    if (DEBUG_REAL_MUTATIONS) {
      console.log(`[proof-A openLong] exchangeRouter: ${await ctx.exchangeRouter.getAddress()}`);
      console.log(`[proof-A openLong] calls.length: ${calls.length}`);
    }

    if (DEBUG_REAL_MUTATIONS) {
      await debugMulticallLegs(router, signer, [
        { name: "sendWnt(order)", data: sendWntData, value: executionFee },
        { name: "sendTokens(order)", data: sendTokensData, value: 0n },
        { name: "createOrder", data: createOrderData, value: 0n }
      ]);
    }

    const tx = await router.multicall(calls, {
      value: executionFee,
      gasLimit: 4_000_000
    });

    if (DEBUG_REAL_MUTATIONS) {
      console.log(`[proof-A openLong] tx.to: ${tx.to}`);
      console.log(`[proof-A openLong] tx.data[0:10]: ${tx.data?.slice(0, 10)}`);
    }

    const receipt = await tx.wait();
    if (DEBUG_REAL_MUTATIONS) {
      const orderCountAfter = dataStore ? await (dataStore as any).getBytes32Count(ORDER_LIST_KEY) : 0n;
      console.log(
        `[proof-B openLong] OrderStore count before: ${orderCountBefore.toString()}  after: ${orderCountAfter.toString()}`
      );

      console.log(
        `Open long tx: ${receipt.hash} status=${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed.toString()} logs=${receipt.logs.length}`
      );
      if (receipt.logs.length > 0) {
        for (const [idx, log] of receipt.logs.slice(0, 5).entries()) {
          const topic0 = log.topics && log.topics.length > 0 ? log.topics[0] : "none";
          console.log(`Open long log[${idx}] topic0=${topic0}`);
        }
      }
    }
  }
}

export async function requireArbitrumForkOrSkip(skip: () => void): Promise<void> {
  const activeChain = getActiveChain();
  const rpcConfigured =
    activeChain === "avalanche"
      ? Boolean(process.env.AVALANCHE_RPC || process.env.AVALANCHE_RPC_URL)
      : Boolean(process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL);
  if (!rpcConfigured) {
    skip();
    return;
  }

  const blockNumber = await ethers.provider.getBlockNumber();
  if (blockNumber < 1000000) {
    skip();
  }
}

export async function createContext(
  options: { adapterMode?: AdapterMode; userAddresses?: string[]; marketSet?: MarketSet } = {}
): Promise<GMXInvariantContext> {
  const [signer, userA, userB] = await ethers.getSigners();

  const vault = await ethers.getContractAt("IGMXVault", DEFAULT_VAULT);
  const exchangeRouter = await ethers.getContractAt("IExchangeRouter", DEFAULT_EXCHANGE_ROUTER);
  const selectedMarket = options.marketSet || MARKET_SETS[0];

  const adapterMode = options.adapterMode || "auto";
  const useRealAdapter = adapterMode === "real" || (adapterMode === "auto" && REAL_MUTATIONS_ENABLED);
  const resolvedUsers = options.userAddresses && options.userAddresses.length >= 2
    ? options.userAddresses.slice(0, 2)
    : [userA.address, userB.address];

  return {
    vault,
    exchangeRouter,
    users: resolvedUsers,
    signer,
    market: selectedMarket.market,
    indexToken: selectedMarket.indexToken,
    longToken: selectedMarket.longToken,
    shortToken: selectedMarket.shortToken,
    collateralToken: selectedMarket.collateralToken,
    collateralDecimals: selectedMarket.collateralDecimals,
    collateralUsdPerToken: selectedMarket.collateralUsdPerToken,
    whale: selectedMarket.whale,
    trackedTokens: DEFAULT_TOKENS,
    trackedPositions: [
      {
        collateralToken: selectedMarket.collateralToken,
        indexToken: selectedMarket.indexToken,
        isLong: true
      },
      {
        collateralToken: selectedMarket.collateralToken,
        indexToken: selectedMarket.indexToken,
        isLong: false
      }
    ],
    adapter: useRealAdapter ? new RealForkActionAdapter() : new NoopActionAdapter(),
    userNetDepositsUsd: new Map<string, bigint>(),
    actionTrace: []
  };
}

export async function getPoolState(ctx: GMXInvariantContext): Promise<PoolState> {
  const tokens: PoolTokenState[] = [];
  const vaultAddress = await ctx.vault.getAddress();

  for (const tokenAddress of ctx.trackedTokens) {
    const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);

    let maxPrice: bigint;
    let minPrice: bigint;
    try {
      [maxPrice, minPrice] = await Promise.all([
        ctx.vault.getMaxPrice(tokenAddress),
        ctx.vault.getMinPrice(tokenAddress)
      ]);
    } catch (error) {
      if (!isHistoricalHardforkLookupError(error)) {
        throw error;
      }

      [maxPrice, minPrice] = await Promise.all([
        readAtForkBlock<bigint>(vaultAddress, VAULT_PRICE_ABI, "getMaxPrice", [tokenAddress]),
        readAtForkBlock<bigint>(vaultAddress, VAULT_PRICE_ABI, "getMinPrice", [tokenAddress])
      ]);
    }

    const [symbol, decimals] = await Promise.all([
      token.symbol().catch(() => "UNK"),
      token.decimals().catch(() => 18)
    ]);

    let poolAmount: bigint;
    let reservedAmount: bigint;
    let usdgAmount: bigint;
    let guaranteedUsd: bigint;
    let feeReserve: bigint;
    let vaultBalance: bigint;

    try {
      [poolAmount, reservedAmount, usdgAmount, guaranteedUsd, feeReserve, vaultBalance] = await Promise.all([
        ctx.vault.poolAmounts(tokenAddress),
        ctx.vault.reservedAmounts(tokenAddress),
        ctx.vault.usdgAmounts(tokenAddress),
        ctx.vault.guaranteedUsd(tokenAddress),
        ctx.vault.feeReserves(tokenAddress),
        token.balanceOf(vaultAddress)
      ]);
    } catch (error) {
      if (!isHistoricalHardforkLookupError(error)) {
        throw error;
      }

      [poolAmount, reservedAmount, usdgAmount, guaranteedUsd, feeReserve, vaultBalance] = await Promise.all([
        readAtForkBlock<bigint>(vaultAddress, VAULT_POOL_ABI, "poolAmounts", [tokenAddress]),
        readAtForkBlock<bigint>(vaultAddress, VAULT_POOL_ABI, "reservedAmounts", [tokenAddress]),
        readAtForkBlock<bigint>(vaultAddress, VAULT_POOL_ABI, "usdgAmounts", [tokenAddress]),
        readAtForkBlock<bigint>(vaultAddress, VAULT_POOL_ABI, "guaranteedUsd", [tokenAddress]),
        readAtForkBlock<bigint>(vaultAddress, VAULT_POOL_ABI, "feeReserves", [tokenAddress]),
        readAtForkBlock<bigint>(tokenAddress, ERC20_ABI, "balanceOf", [vaultAddress])
      ]);
    }

    tokens.push({
      token: tokenAddress,
      symbol,
      decimals: Number(decimals),
      poolAmount,
      reservedAmount,
      usdgAmount,
      guaranteedUsd,
      feeReserve,
      vaultBalance,
      maxPrice,
      minPrice
    });
  }

  return {
    tokens,
    blockNumber: await ethers.provider.getBlockNumber()
  };
}

export async function getPoolAmount(ctx: GMXInvariantContext, tokenAddress: string): Promise<bigint> {
  return ctx.vault.poolAmounts(tokenAddress);
}

export async function getPositionSize(
  ctx: GMXInvariantContext,
  user: string,
  descriptor: PositionDescriptor
): Promise<bigint> {
  const position = await getUserPosition(ctx, user, descriptor);
  return position.size;
}

export async function getPositionCollateral(
  ctx: GMXInvariantContext,
  user: string,
  descriptor: PositionDescriptor
): Promise<bigint> {
  const position = await getUserPosition(ctx, user, descriptor);
  return position.collateral;
}

export async function getUserBalances(
  ctx: GMXInvariantContext,
  user: string,
  tokens: string[] = ctx.trackedTokens
): Promise<Record<string, bigint>> {
  const balances: Record<string, bigint> = {};
  for (const tokenAddress of tokens) {
    const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
    balances[tokenAddress.toLowerCase()] = await (token as any).balanceOf(user);
  }
  return balances;
}

export async function getPoolAmounts(
  ctx: GMXInvariantContext,
  tokens: string[] = ctx.trackedTokens
): Promise<Record<string, bigint>> {
  const poolAmounts: Record<string, bigint> = {};
  for (const tokenAddress of tokens) {
    poolAmounts[tokenAddress.toLowerCase()] = await getPoolAmount(ctx, tokenAddress);
  }
  return poolAmounts;
}

export async function getUserPosition(
  ctx: GMXInvariantContext,
  user: string,
  descriptor: PositionDescriptor
): Promise<PositionSnapshot> {
  let position: any;
  try {
    position = await ctx.vault.getPosition(
      user,
      descriptor.collateralToken,
      descriptor.indexToken,
      descriptor.isLong
    );
  } catch (error) {
    if (!isHistoricalHardforkLookupError(error)) {
      throw error;
    }

    const data = ctx.vault.interface.encodeFunctionData("getPosition", [
      user,
      descriptor.collateralToken,
      descriptor.indexToken,
      descriptor.isLong
    ]);
    const raw = await getDirectRpcProvider().call(
      {
        to: await ctx.vault.getAddress(),
        data
      },
      getForkBlockNumber()
    );
    const decoded = ctx.vault.interface.decodeFunctionResult("getPosition", raw);
    position = decoded[0] ?? decoded;
  }

  const size = position.size ?? position[0] ?? 0n;
  const collateral = position.collateral ?? position[1] ?? 0n;
  const averagePrice = position.averagePrice ?? position[2] ?? 0n;
  const reserveAmount = position.reserveAmount ?? position[4] ?? 0n;

  return {
    size,
    collateral,
    averagePrice,
    reserveAmount
  };
}

export async function getTotalAssets(ctx: GMXInvariantContext): Promise<bigint> {
  const state = await getPoolState(ctx);
  return state.tokens.reduce((acc, token) => acc + token.poolAmount, 0n);
}

function stringifyWithBigInt(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2
  );
}

export async function assertInvariant(
  name: string,
  check: () => Promise<void>,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await check();
  } catch (error) {
    const outputDir = path.join(process.cwd(), "outputs", "invariant-failures");
    fs.mkdirSync(outputDir, { recursive: true });
    const safeName = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-");
    const pocPath = path.join(outputDir, `${safeName}-${Date.now()}.json`);
    const payload = {
      invariant: name,
      failedAt: new Date().toISOString(),
      error: (error as Error).message,
      context: context || {}
    };
    fs.writeFileSync(pocPath, `${stringifyWithBigInt(payload)}\n`, "utf8");
    throw new Error(`Invariant failed [${name}]: ${(error as Error).message}`);
  }
}

function bumpUserLedger(ctx: GMXInvariantContext, user: string, deltaUsd: bigint): void {
  const current = ctx.userNetDepositsUsd.get(user) || 0n;
  ctx.userNetDepositsUsd.set(user, current + deltaUsd);
}

export async function runAction(ctx: GMXInvariantContext, action: ActionInput): Promise<void> {
  ctx.actionTrace.push(action);
  const user = action.user || ctx.users[0];
  const amountUsd = action.amountUsd || action.collateralUsd || 0n;

  switch (action.type) {
    case "deposit":
      bumpUserLedger(ctx, user, amountUsd);
      await ctx.adapter.deposit(ctx, action);
      return;
    case "withdraw":
      {
        const current = ctx.userNetDepositsUsd.get(user) || 0n;
        const applied = amountUsd > current ? current : amountUsd;
        if (applied === 0n) {
          await network.provider.send("evm_mine");
          return;
        }
        bumpUserLedger(ctx, user, -applied);
      }
      await ctx.adapter.withdraw(ctx, action);
      return;
    case "openLong":
      await ctx.adapter.openLong(ctx, action);
      return;
    case "openShort":
      await ctx.adapter.openShort(ctx, action);
      return;
    case "increasePosition":
      await ctx.adapter.increasePosition(ctx, action);
      return;
    case "decreasePosition":
      await ctx.adapter.decreasePosition(ctx, action);
      return;
    case "liquidate":
      await ctx.adapter.liquidate(ctx, action);
      return;
    default:
      throw new Error(`Unsupported action type ${(action as ActionInput).type}`);
  }
}

export async function assertCoreInvariants(ctx: GMXInvariantContext): Promise<void> {
  await assertInvariant("total pool assets >= synthetic user claims", async () => {
    const totalAssets = await getTotalAssets(ctx);
    const syntheticClaims = Array.from(ctx.userNetDepositsUsd.values()).reduce(
      (acc, amount) => (amount > 0n ? acc + amount : acc),
      0n
    );
    expect(totalAssets).to.be.gte(syntheticClaims);
  }, {
    blockNumber: await ethers.provider.getBlockNumber(),
    actionTrace: ctx.actionTrace,
    users: ctx.users
  });

  await assertInvariant("position collateral consistency", async () => {
    for (const user of ctx.users) {
      for (const descriptor of ctx.trackedPositions) {
        const position = await getUserPosition(ctx, user, descriptor);
        expect(position.collateral).to.be.gte(0n);
        expect(position.size).to.be.gte(position.collateral);
      }
    }
  }, {
    actionTrace: ctx.actionTrace,
    users: ctx.users
  });

  await assertInvariant("no user can withdraw more than deposited", async () => {
    for (const [user, netDeposit] of ctx.userNetDepositsUsd.entries()) {
      expect(netDeposit, `negative net deposit for ${user}`).to.be.gte(0n);
    }
  }, {
    netDeposits: Object.fromEntries(ctx.userNetDepositsUsd.entries()),
    actionTrace: ctx.actionTrace
  });

  await assertInvariant("vault reserves and router accounting consistency", async () => {
    const state = await getPoolState(ctx);

    for (const tokenState of state.tokens) {
      expect(tokenState.reservedAmount).to.be.lte(tokenState.poolAmount);
      expect(tokenState.poolAmount).to.be.lte(tokenState.vaultBalance);
    }

    const exchangeRouterAddress = await ctx.exchangeRouter.getAddress();
    if (exchangeRouterAddress !== "0x0000000000000000000000000000000000000000") {
      for (const tokenAddress of ctx.trackedTokens) {
        const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
        let routerBal: bigint;
        try {
          routerBal = await token.balanceOf(exchangeRouterAddress);
        } catch (error) {
          if (!isHistoricalHardforkLookupError(error)) {
            throw error;
          }
          routerBal = await readAtForkBlock<bigint>(tokenAddress, ERC20_ABI, "balanceOf", [exchangeRouterAddress]);
        }
        expect(routerBal).to.be.gte(0n);
      }
    }
  }, {
    blockNumber: await ethers.provider.getBlockNumber(),
    actionTrace: ctx.actionTrace,
    exchangeRouter: await ctx.exchangeRouter.getAddress()
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GMX v2 Lifecycle Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract an order/withdrawal key from a receipt by scanning EventLog1 logs.
 * EventLog1 encodes: topics[1]=keccak256(eventName), topics[2]=key (indexed topic1).
 */
export function getEventKey(receipt: any, eventName: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(eventName));
  for (const log of receipt.logs ?? []) {
    if (!log.topics || log.topics.length < 3) continue;
    if (log.topics[1].toLowerCase() !== hash.toLowerCase()) continue;
    return log.topics[2];
  }
  throw new Error(
    `EventLog1("${eventName}") not found in receipt. ` +
      `Tx: ${receipt.hash} | logs: ${receipt.logs?.length ?? 0}`
  );
}

export async function isAdlRequired(market: string, isLong: boolean): Promise<boolean> {
  const dataStore = await ethers.getContractAt(["function getBool(bytes32 key) view returns (bool)"], DEFAULT_DATA_STORE);
  const key = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "bool"], [IS_ADL_ENABLED_KEY, market, isLong])
  );
  return Boolean(await (dataStore as any).getBool(key));
}

async function getListCount(listKey: string): Promise<bigint> {
  const dataStore = await ethers.getContractAt(DATASTORE_LIFECYCLE_ABI, DEFAULT_DATA_STORE);
  return BigInt((await (dataStore as any).getBytes32Count(listKey)).toString());
}

async function getLastListItem(listKey: string): Promise<string | undefined> {
  const dataStore = await ethers.getContractAt(DATASTORE_LIFECYCLE_ABI, DEFAULT_DATA_STORE);
  const count = await getListCount(listKey);
  if (count === 0n) {
    return undefined;
  }
  const values: string[] = await (dataStore as any).getBytes32ValuesAt(listKey, count - 1n, count);
  return values[0];
}

async function resolveKeeper(roleName = "ORDER_KEEPER"): Promise<string> {
  if (DEFAULT_KEEPER) return DEFAULT_KEEPER;
  if (DEFAULT_ROLE_STORE === "0x0000000000000000000000000000000000000000") {
    throw new Error("Set GMX_KEEPER_ADDRESS or GMX_ROLE_STORE_ADDRESS in .env");
  }
  const roleStore = await ethers.getContractAt(ROLE_STORE_QUERY_ABI, DEFAULT_ROLE_STORE);
  const roleKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["string"], [roleName])
  );
  const keepers: string[] = await (roleStore as any).getRoleMembers(roleKey, 0n, 1n);
  if (!keepers.length) throw new Error(`No ${roleName} found in RoleStore`);
  return keepers[0];
}

// ── Types ─────────────────────────────────────────────────────────────────
export type OracleParams = { tokens: string[]; providers: string[]; data: string[] };
export type OraclePriceOverrideMap = Record<string, bigint>;

export type CreateOrderParams = {
  marketSet: MarketSet;
  signer: any;
  sizeDeltaUsd: bigint;
  isLong: boolean;
  executionFee?: bigint;
  collateralUsd?: bigint;
};

export type CreateWithdrawalParams = {
  marketSet: MarketSet;
  signer: any;
  marketTokenAmount: bigint;
  executionFee?: bigint;
};

export type CreateDepositParams = {
  marketSet: MarketSet;
  signer: any;
  longTokenAmount: bigint;
  shortTokenAmount?: bigint;
  executionFee?: bigint;
  minMarketTokens?: bigint;
};

// ── Mock oracle setup ─────────────────────────────────────────────────────
let _mockOraclePatched = false;
const _mockOraclePriceOverrides = new Map<string, bigint>();

function normalizeTokenAddress(token: string): string {
  return token.toLowerCase();
}

export function setMockOraclePrice(token: string, priceE30: bigint): void {
  _mockOraclePriceOverrides.set(normalizeTokenAddress(token), priceE30);
}

export function clearMockOraclePrices(): void {
  _mockOraclePriceOverrides.clear();
}

export async function withMockOraclePrices<T>(
  overrides: OraclePriceOverrideMap,
  fn: () => Promise<T>
): Promise<T> {
  const previous = new Map(_mockOraclePriceOverrides);
  _mockOraclePriceOverrides.clear();
  for (const [token, price] of Object.entries(overrides)) {
    setMockOraclePrice(token, price);
  }

  try {
    return await fn();
  } finally {
    _mockOraclePriceOverrides.clear();
    for (const [token, price] of previous.entries()) {
      _mockOraclePriceOverrides.set(token, price);
    }
  }
}

export async function patchMockOracleVerifier(): Promise<void> {
  if (_mockOraclePatched) return;
  if (DEFAULT_DATA_STREAM_PROVIDER === "0x0000000000000000000000000000000000000000") return;
  const dsp = await ethers.getContractAt(
    ["function verifier() view returns (address)"],
    DEFAULT_DATA_STREAM_PROVIDER
  );
  const verifierAddress: string = await (dsp as any).verifier();
  const mockVerifier = await ethers.deployContract("MockChainlinkDataStreamVerifier");
  await mockVerifier.waitForDeployment();
  const mockCode = await ethers.provider.getCode(await mockVerifier.getAddress());
  await network.provider.send("hardhat_setCode", [verifierAddress, mockCode]);
  _mockOraclePatched = true;
}

async function getRealOraclePrice(dataStore: any, token: string): Promise<bigint> {
  const keyBase = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["PRICE_FEED"])
  );
  const mulBase = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["PRICE_FEED_MULTIPLIER"])
  );

  const feedKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address"], [keyBase, token])
  );
  const mulKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address"], [mulBase, token])
  );

  const feedAddr: string = await (dataStore as any).getAddress(feedKey);
  const multiplier = BigInt((await (dataStore as any).getUint(mulKey)).toString());
  if (feedAddr === ethers.ZeroAddress || multiplier === 0n) {
    throw new Error(`Missing chainlink config for token ${token}`);
  }
  if (feedAddr.toLowerCase() === DEFAULT_DATA_STORE.toLowerCase()) {
    throw new Error(`BUG: feed resolved to DataStore for token ${token}`);
  }

  const feed = await ethers.getContractAt(
    ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"],
    feedAddr
  );
  const [, answer] = await (feed as any).latestRoundData();
  const signedAnswer = BigInt(answer.toString());
  const absAnswer = signedAnswer < 0n ? -signedAnswer : signedAnswer;
  // Convert to GMX adjusted price scale, matching executeOrderWithMockDataStream.ts.
  return (absAnswer * multiplier) / 10n ** 30n;
}

async function getChainlinkProviderRefPrice(token: string): Promise<bigint> {
  if (DEFAULT_CHAINLINK_PRICE_FEED_PROVIDER === ethers.ZeroAddress) {
    throw new Error("Missing chainlink price feed provider address");
  }

  const provider = await ethers.getContractAt(
    CHAINLINK_PRICE_FEED_PROVIDER_ABI,
    DEFAULT_CHAINLINK_PRICE_FEED_PROVIDER
  );

  try {
    const price = await (provider as any).getOraclePrice(token, "0x");
    const min = BigInt((price.min ?? price[1]).toString());
    const max = BigInt((price.max ?? price[2]).toString());
    return (min + max) / 2n;
  } catch (error) {
    if (!isHistoricalHardforkLookupError(error)) {
      throw error;
    }

    const price = await readAtForkBlock<any>(
      DEFAULT_CHAINLINK_PRICE_FEED_PROVIDER,
      CHAINLINK_PRICE_FEED_PROVIDER_ABI,
      "getOraclePrice",
      [token, "0x"]
    );
    const min = BigInt((price.min ?? price[1]).toString());
    const max = BigInt((price.max ?? price[2]).toString());
    return (min + max) / 2n;
  }
}

/**
 * Build mock oracle params for the given token addresses using on-chain price feeds.
 * Automatically patches the Chainlink verifier with MockChainlinkDataStreamVerifier.
 */
export async function buildMockOracleParams(
  tokens: string[],
  options?: { priceOverrides?: OraclePriceOverrideMap }
): Promise<OracleParams> {
  if (DEFAULT_DATA_STORE === "0x0000000000000000000000000000000000000000") {
    throw new Error("GMX_DATA_STORE_ADDRESS required for buildMockOracleParams");
  }
  await patchMockOracleVerifier();

  const dataStore = await ethers.getContractAt(DATASTORE_LIFECYCLE_ABI, DEFAULT_DATA_STORE);
  const latestBlock = await ethers.provider.getBlock("latest");
  const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
  const oracleTimestamp = now + 60;

  function dsKey(name: string): string {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], [name]));
  }
  function tokenKey(base: string, tokenAddress: string): string {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address"], [base, tokenAddress]));
  }

  const dsIdKey = dsKey("DATA_STREAM_ID");
  const dsMulKey = dsKey("DATA_STREAM_MULTIPLIER");
  const pfKey = dsKey("PRICE_FEED");
  const pfMulKey = dsKey("PRICE_FEED_MULTIPLIER");

  const PRICE_FEED_ABI = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];
  const data: string[] = [];
  const effectiveOverrides = new Map<string, bigint>(_mockOraclePriceOverrides);
  if (options?.priceOverrides) {
    for (const [token, price] of Object.entries(options.priceOverrides)) {
      effectiveOverrides.set(normalizeTokenAddress(token), price);
    }
  }

  for (const token of tokens) {
    const feedId: string = await (dataStore as any).getBytes32(tokenKey(dsIdKey, token));
    const dsMul = BigInt((await (dataStore as any).getUint(tokenKey(dsMulKey, token))).toString());
    const pfAddr: string = await (dataStore as any).getAddress(tokenKey(pfKey, token));
    const pfMul = BigInt((await (dataStore as any).getUint(tokenKey(pfMulKey, token))).toString());

    let rawPrice = 1_000_000_000n; // fallback
    let pricingMode = "fallback"; // updated as each source is resolved
    const overridePriceE30 = effectiveOverrides.get(normalizeTokenAddress(token));
    if (overridePriceE30 !== undefined && dsMul > 0n) {
      rawPrice = (overridePriceE30 * 10n ** 30n) / dsMul;
      pricingMode = "override";
      if (process.env.GMX_DEBUG_ORACLE === "1") {
        console.log(
          `[oracle-debug] token=${token.toLowerCase()} overridePriceE30=${overridePriceE30.toString()} dsMul=${dsMul.toString()} rawPrice=${rawPrice.toString()} mode=override`
        );
      }
    } else if (pfAddr !== ethers.ZeroAddress && pfMul > 0n && dsMul > 0n) {
      try {
        if (pfAddr.toLowerCase() === DEFAULT_DATA_STORE.toLowerCase()) {
          throw new Error(`price feed key resolved to DataStore for token ${token}`);
        }
        // Use fork-block RPC so this always resolves even after hardhat_mine.
        const result = await readAtForkBlock<any>(pfAddr, PRICE_FEED_ABI, "latestRoundData");
        const answer = BigInt(result[1].toString());
        rawPrice = (answer * pfMul) / dsMul;
          pricingMode = "feed";
        if (process.env.GMX_DEBUG_ORACLE === "1") {
          console.log(
            `[oracle-debug] token=${token.toLowerCase()} feed=${pfAddr.toLowerCase()} answer=${answer.toString()} pfMul=${pfMul.toString()} dsMul=${dsMul.toString()} rawPrice=${rawPrice.toString()} mode=feed`
          );
        }
      } catch {
        try {
          rawPrice = (await getChainlinkProviderRefPrice(token) * 10n ** 30n) / dsMul;
            pricingMode = "chainlink-provider";
          if (process.env.GMX_DEBUG_ORACLE === "1") {
            console.log(
              `[oracle-debug] token=${token.toLowerCase()} rawPrice=${rawPrice.toString()} mode=chainlink-provider`
            );
          }
        } catch {
          try {
            rawPrice = await getRealOraclePrice(dataStore, token);
              pricingMode = "real-price-feed";
            if (process.env.GMX_DEBUG_ORACLE === "1") {
              console.log(
                `[oracle-debug] token=${token.toLowerCase()} rawPrice=${rawPrice.toString()} mode=real-price-feed`
              );
            }
          } catch {
            // Deterministic token-specific fallback to stay close to ref prices.
            const tokenLc = token.toLowerCase();
            const tokenContract = await ethers.getContractAt(ERC20_ABI, token);
            const decimals = Number(await (tokenContract as any).decimals());

            let approxUsd = 1n;
            if (tokenLc === "0x82af49447d8a07e3bd95bd0d56f35241523fbab1") {
              approxUsd = 2_000n; // WETH
            } else if (tokenLc === "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab") {
              approxUsd = 2_000n; // WETH.e (Avalanche)
            } else if (tokenLc === "0x2f2a2543b76a4166549f7aaab2e75bef0aefc5b0") {
              approxUsd = 60_000n; // WBTC
            } else if (tokenLc === "0x50b7545627a5162f82a992c33b87adc75187b218") {
              approxUsd = 60_000n; // WBTC.e (Avalanche)
            } else if (tokenLc === "0xaf88d065e77c8cc2239327c5edb3a432268e5831") {
              approxUsd = 1n; // USDC
            } else if (tokenLc === "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e") {
              approxUsd = 1n; // USDC (Avalanche)
            } else if (tokenLc === "0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664") {
              approxUsd = 1n; // USDC.e (Avalanche)
            } else if (tokenLc === "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9") {
              approxUsd = 1n; // USDT
            } else if (tokenLc === "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7") {
              approxUsd = 1n; // USDT.e (Avalanche)
            } else if (tokenLc === "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7") {
              approxUsd = 25n; // WAVAX
            }

            const adjustedPrice = approxUsd * 10n ** BigInt(Math.max(0, 30 - decimals));
            rawPrice = (adjustedPrice * 10n ** 30n) / dsMul;
            if (process.env.GMX_DEBUG_ORACLE === "1") {
              console.log(
                `[oracle-debug] token=${token.toLowerCase()} feed=${pfAddr.toLowerCase()} pfMul=${pfMul.toString()} approxUsd=${approxUsd.toString()} decimals=${decimals} dsMul=${dsMul.toString()} rawPrice=${rawPrice.toString()} mode=fallback`
              );
            }
          }
        }
      }
    }

      // Strict mode: only forbid fallback when DataStore has a configured feed.
      // If no feed exists for a token, fallback pricing is currently the expected behavior.
      if (
        process.env.GMX_ALLOW_AVA_ORACLE_EXECUTE === "1" &&
        pricingMode === "fallback" &&
        pfAddr !== ethers.ZeroAddress
      ) {
        throw new Error(
          `[oracle] strict mode (GMX_ALLOW_AVA_ORACLE_EXECUTE=1) forbids static fallback for token ${token}. ` +
          `Ensure DataStore has a Chainlink price feed configured for this token or provide a valid AVALANCHE_RPC.`
        );
      }

    data.push(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,int192,int192,int192)"],
        [[feedId, oracleTimestamp, oracleTimestamp, 0, 0, oracleTimestamp + 3600, rawPrice, rawPrice, rawPrice]]
      )
    );
  }
  return {
    tokens,
    providers: tokens.map(() => DEFAULT_DATA_STREAM_PROVIDER),
    data
  };
}

/**
 * Fund a signer with market (GM) tokens by impersonating a known whale.
 * Returns the amount transferred, or 0n if no whale balance was found.
 */
export async function fundSignerWithMarketTokens(
  ms: MarketSet,
  signer: any,
  minTransfer = 1_000_000n
): Promise<bigint> {
  const signerAddress = await signer.getAddress();
  const marketToken = await ethers.getContractAt(ERC20_ABI, ms.market);
  const marketName = ms.name.toUpperCase();
  const candidates = [
    process.env[`GMX_GM_WHALE_${marketName}`],
    process.env.GMX_GM_WHALE_WETH,
    process.env.GMX_GM_WHALE_WBTC,
    process.env.GMX_GM_WHALE_ARB,
    process.env.GMX_GM_WHALE_ADDRESS,
    process.env.GMX_GM_WHALE,
    process.env.GMX_WHALE_ADDRESS,
    ms.market,
    ms.whale
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const bal = await (marketToken as any).balanceOf(candidate);
    const amount = BigInt(bal.toString());
    if (amount >= minTransfer * 2n) {
      const xfer = amount / 2n;
      await network.provider.send("hardhat_impersonateAccount", [candidate]);
      await network.provider.send("hardhat_setBalance", [candidate, "0x56BC75E2D63100000"]);
      const whaleSigner = await ethers.getSigner(candidate);
      await (marketToken.connect(whaleSigner) as any).transfer(signerAddress, xfer);
      await network.provider.send("hardhat_stopImpersonatingAccount", [candidate]);
      return xfer;
    }
  }
  return 0n;
}

// ── Order lifecycle ────────────────────────────────────────────────────────
/**
 * Create a MarketIncrease order via ExchangeRouter.multicall.
 * Caller must have pre-funded the signer with collateral tokens and ETH.
 */
export async function createOrderForTest(
  params: CreateOrderParams
): Promise<{ key: string; receipt: any }> {
  const { marketSet, signer, sizeDeltaUsd, isLong } = params;
  const requestedExecutionFee = params.executionFee ?? BigInt(DEFAULT_EXECUTION_FEE);
  const executionFee = normalizeExecutionFee(requestedExecutionFee);
  if (executionFee <= 0n) {
    throw new Error("createOrderForTest requires a non-zero executionFee");
  }
  const collateralUsd = params.collateralUsd ?? 500n;
  const signerAddress = await signer.getAddress();
  const tokenAddress = marketSet.collateralToken;
  const collateralAmount =
    (collateralUsd * 10n ** BigInt(marketSet.collateralDecimals)) / marketSet.collateralUsdPerToken;

  const token = await ethers.getContractAt(ERC20_ABI, tokenAddress);
  await (token.connect(signer) as any).approve(DEFAULT_ROUTER, collateralAmount);

  const orderCountBefore = await getListCount(ORDER_LIST_KEY);

  const router = await ethers.getContractAt("IExchangeRouter", DEFAULT_EXCHANGE_ROUTER);
  const orderParams = {
    addresses: {
      receiver: signerAddress,
      cancellationReceiver: signerAddress,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: marketSet.market,
      initialCollateralToken: tokenAddress,
      swapPath: []
    },
    numbers: {
      sizeDeltaUsd,
      initialCollateralDeltaAmount: collateralAmount,
      triggerPrice: 0n,
      acceptablePrice: isLong ? ethers.MaxUint256 : 0n,
      executionFee,
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n
    },
    orderType: 2, // MarketIncrease
    decreasePositionSwapType: 0,
    isLong,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: []
  };

  let receipt: any | undefined;
  if (getActiveChain() === "avalanche") {
    try {
      const directTx = await (router.connect(signer) as any).createOrder(orderParams, {
        value: executionFee,
        gasLimit: 4_000_000
      });
      const directReceipt = await directTx.wait();
      if ((directReceipt.logs?.length ?? 0) > 0) {
        receipt = directReceipt;
      }
    } catch {
      // Fall back to multicall path below.
    }
  }

  if (!receipt) {
    const iface = router.interface;
    const sendWntData = iface.encodeFunctionData("sendWnt", [DEFAULT_ORDER_VAULT, executionFee]);
    const sendTokensData = iface.encodeFunctionData("sendTokens", [
      tokenAddress,
      DEFAULT_ORDER_VAULT,
      collateralAmount
    ]);
    const createOrderData = iface.encodeFunctionData("createOrder", [orderParams]);

    if (process.env.GMX_DEBUG_CALLS === "1") {
      process.stdout.write(
        `[PROBE] about to multicall, calls.length=3, value=${executionFee.toString()}\n`
      );
      for (const c of [sendWntData, sendTokensData, createOrderData]) {
        try {
          const parsed = router.interface.parseTransaction({ data: c });
          process.stdout.write(`[PROBE]   call: ${parsed?.name} ${JSON.stringify(parsed?.args)}\n`);
        } catch {
          process.stdout.write(`[PROBE]   call: unparseable ${c.slice(0, 10)}\n`);
        }
      }
    }

    const tx = await (router.connect(signer) as any).multicall(
      [sendWntData, sendTokensData, createOrderData],
      { value: executionFee, gasLimit: 4_000_000 }
    );
    receipt = await tx.wait();
  }

  if (process.env.GMX_DEBUG_EXEC_FEE === "1") {
    console.log(
      `[createOrderForTest] chain=${getActiveChain()} exchangeRouter=${DEFAULT_EXCHANGE_ROUTER} orderVault=${DEFAULT_ORDER_VAULT} market=${marketSet.market} collateralToken=${tokenAddress} collateralAmount=${collateralAmount.toString()} requestedExecutionFee=${requestedExecutionFee.toString()} executionFee=${executionFee.toString()} value=${executionFee.toString()} status=${String(receipt.status)} logs=${receipt.logs?.length ?? 0} events=${(receipt as any).events?.length ?? 0}`
    );
  }
  let key: string;
  try {
    key = getEventKey(receipt, "OrderCreated");
  } catch {
    const orderCountAfter = await getListCount(ORDER_LIST_KEY);
    if (orderCountAfter > orderCountBefore) {
      const recovered = await getLastListItem(ORDER_LIST_KEY);
      if (recovered) {
        key = recovered;
      } else {
        throw new Error("OrderCreated event missing and ORDER_LIST latest key could not be recovered");
      }
    } else {
      throw new Error(
        `OrderCreated event missing and ORDER_LIST did not grow (before=${orderCountBefore.toString()}, after=${orderCountAfter.toString()})`
      );
    }
  }
  return { key, receipt };
}

export async function cancelOrderForTest(signer: any, key: string): Promise<any> {
  // GMX enforces a 300-block time-lock before cancellation; advance past it.
  await network.provider.send("hardhat_mine", ["0x131"]); // 305 blocks
  const router = await ethers.getContractAt(LIFECYCLE_ROUTER_ABI, DEFAULT_EXCHANGE_ROUTER);
  const tx = await (router.connect(signer) as any).cancelOrder(key, { gasLimit: 2_000_000 });
  return tx.wait();
}

export async function executeOrderForTest(
  key: string,
  oracleParams: OracleParams
): Promise<any> {
  const keeperAddress = await resolveKeeper();
  await network.provider.send("hardhat_impersonateAccount", [keeperAddress]);
  await network.provider.send("hardhat_setBalance", [keeperAddress, "0x56BC75E2D63100000"]);
  try {
    const keeper = await ethers.getSigner(keeperAddress);
    const handler = await ethers.getContractAt(ORDER_HANDLER_EXECUTE_ABI, DEFAULT_ORDER_HANDLER);
    const tx = await (handler.connect(keeper) as any).executeOrder(key, oracleParams, {
      gasLimit: 8_000_000
    });
    return tx.wait();
  } finally {
    await network.provider.send("hardhat_stopImpersonatingAccount", [keeperAddress]);
  }
}

// ── Deposit lifecycle ──────────────────────────────────────────────────────
/**
 * Create a deposit via ExchangeRouter.multicall.
 * Caller must pre-fund signer with long/short tokens and ETH.
 */
export async function createDepositForTest(
  params: CreateDepositParams
): Promise<{ key: string; receipt: any }> {
  const { marketSet, signer, longTokenAmount } = params;
  const shortTokenAmount = params.shortTokenAmount ?? 0n;
  const requestedExecutionFee = params.executionFee ?? BigInt(DEFAULT_EXECUTION_FEE);
  const executionFee = normalizeExecutionFee(requestedExecutionFee);
  if (executionFee <= 0n) {
    throw new Error("createDepositForTest requires a non-zero executionFee");
  }
  const minMarketTokens = params.minMarketTokens ?? 0n;
  const signerAddress = await signer.getAddress();

  const longToken = await ethers.getContractAt(ERC20_ABI, marketSet.longToken);
  await (longToken.connect(signer) as any).approve(DEFAULT_ROUTER, longTokenAmount);

  if (shortTokenAmount > 0n) {
    const shortToken = await ethers.getContractAt(ERC20_ABI, marketSet.shortToken);
    await (shortToken.connect(signer) as any).approve(DEFAULT_ROUTER, shortTokenAmount);
  }

  const router = await ethers.getContractAt(LIFECYCLE_ROUTER_ABI, DEFAULT_EXCHANGE_ROUTER);
  const depositCountBefore = await getListCount(DEPOSIT_LIST_KEY);
  const depositParams = {
    addresses: {
      receiver: signerAddress,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: marketSet.market,
      initialLongToken: marketSet.longToken,
      initialShortToken: marketSet.shortToken,
      longTokenSwapPath: [],
      shortTokenSwapPath: []
    },
    minMarketTokens,
    shouldUnwrapNativeToken: false,
    executionFee,
    callbackGasLimit: 0n,
    dataList: []
  };

  let receipt: any | undefined;
  if (getActiveChain() === "avalanche") {
    try {
      const directTx = await (router.connect(signer) as any).createDeposit(depositParams, {
        value: executionFee,
        gasLimit: 5_000_000
      });
      const directReceipt = await directTx.wait();
      if ((directReceipt.logs?.length ?? 0) > 0) {
        receipt = directReceipt;
      }
    } catch {
      // Fall back to multicall path below.
    }
  }

  if (!receipt) {
    const iface = router.interface;
    const sendWntData = iface.encodeFunctionData("sendWnt", [DEFAULT_DEPOSIT_VAULT, executionFee]);
    const calls: string[] = [sendWntData];

    if (longTokenAmount > 0n) {
      calls.push(
        iface.encodeFunctionData("sendTokens", [
          marketSet.longToken,
          DEFAULT_DEPOSIT_VAULT,
          longTokenAmount
        ])
      );
    }
    if (shortTokenAmount > 0n) {
      calls.push(
        iface.encodeFunctionData("sendTokens", [
          marketSet.shortToken,
          DEFAULT_DEPOSIT_VAULT,
          shortTokenAmount
        ])
      );
    }
    calls.push(iface.encodeFunctionData("createDeposit", [depositParams]));

    const tx = await (router.connect(signer) as any).multicall(calls, {
      value: executionFee,
      gasLimit: 5_000_000
    });
    receipt = await tx.wait();
  }

  if (process.env.GMX_DEBUG_EXEC_FEE === "1") {
    console.log(
      `[createDepositForTest] chain=${getActiveChain()} exchangeRouter=${DEFAULT_EXCHANGE_ROUTER} depositVault=${DEFAULT_DEPOSIT_VAULT} requestedExecutionFee=${requestedExecutionFee.toString()} executionFee=${executionFee.toString()} value=${executionFee.toString()} status=${String(receipt.status)} logs=${receipt.logs?.length ?? 0} events=${(receipt as any).events?.length ?? 0}`
    );
  }
  let key: string;
  try {
    key = getEventKey(receipt, "DepositCreated");
  } catch {
    const depositCountAfter = await getListCount(DEPOSIT_LIST_KEY);
    if (depositCountAfter > depositCountBefore) {
      const recovered = await getLastListItem(DEPOSIT_LIST_KEY);
      if (recovered) {
        key = recovered;
      } else {
        throw new Error("DepositCreated event missing and DEPOSIT_LIST latest key could not be recovered");
      }
    } else {
      throw new Error(
        `DepositCreated event missing and DEPOSIT_LIST did not grow (before=${depositCountBefore.toString()}, after=${depositCountAfter.toString()})`
      );
    }
  }
  return { key, receipt };
}

export async function executeDepositForTest(
  key: string,
  oracleParams: OracleParams
): Promise<any> {
  let keeperAddress: string;
  try {
    keeperAddress = await resolveKeeper("DEPOSIT_KEEPER");
  } catch {
    keeperAddress = await resolveKeeper("ORDER_KEEPER");
  }

  await network.provider.send("hardhat_impersonateAccount", [keeperAddress]);
  await network.provider.send("hardhat_setBalance", [keeperAddress, "0x56BC75E2D63100000"]);
  try {
    const keeper = await ethers.getSigner(keeperAddress);
    const handler = await ethers.getContractAt(DEPOSIT_HANDLER_EXECUTE_ABI, DEFAULT_DEPOSIT_HANDLER);
    const tx = await (handler.connect(keeper) as any).executeDeposit(key, oracleParams, {
      gasLimit: 8_000_000
    });
    return tx.wait();
  } finally {
    await network.provider.send("hardhat_stopImpersonatingAccount", [keeperAddress]);
  }
}

export async function cancelDepositForTest(signer: any, key: string): Promise<any> {
  // Same request-age cancellation guard pattern as order/withdrawal.
  await network.provider.send("hardhat_mine", ["0x131"]); // 305 blocks
  const router = await ethers.getContractAt(LIFECYCLE_ROUTER_ABI, DEFAULT_EXCHANGE_ROUTER);
  const tx = await (router.connect(signer) as any).cancelDeposit(key, { gasLimit: 2_000_000 });
  return tx.wait();
}

// ── Withdrawal lifecycle ───────────────────────────────────────────────────
/**
 * Create a withdrawal via ExchangeRouter.multicall.
 * Caller must pre-fund the signer with market (GM) tokens and ETH.
 */
export async function createWithdrawalForTest(
  params: CreateWithdrawalParams
): Promise<{ key: string; receipt: any }> {
  const { marketSet, signer, marketTokenAmount } = params;
  const requestedExecutionFee = params.executionFee ?? BigInt(DEFAULT_EXECUTION_FEE);
  const executionFee = normalizeExecutionFee(requestedExecutionFee);
  if (executionFee <= 0n) {
    throw new Error("createWithdrawalForTest requires a non-zero executionFee");
  }
  const signerAddress = await signer.getAddress();

  const marketToken = await ethers.getContractAt(ERC20_ABI, marketSet.market);
  await (marketToken.connect(signer) as any).approve(DEFAULT_ROUTER, marketTokenAmount);

  const router = await ethers.getContractAt(LIFECYCLE_ROUTER_ABI, DEFAULT_EXCHANGE_ROUTER);
  const withdrawalCountBefore = await getListCount(WITHDRAWAL_LIST_KEY);
  const withdrawalParams = {
    addresses: {
      receiver: signerAddress,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: marketSet.market,
      longTokenSwapPath: [],
      shortTokenSwapPath: []
    },
    minLongTokenAmount: 0n,
    minShortTokenAmount: 0n,
    shouldUnwrapNativeToken: false,
    executionFee,
    callbackGasLimit: 0n,
    dataList: []
  };

  const iface = router.interface;
  const sendWntData = iface.encodeFunctionData("sendWnt", [DEFAULT_WITHDRAWAL_VAULT, executionFee]);
  const sendTokensData = iface.encodeFunctionData("sendTokens", [
    marketSet.market,
    DEFAULT_WITHDRAWAL_VAULT,
    marketTokenAmount
  ]);
  const createWithdrawalData = iface.encodeFunctionData("createWithdrawal", [withdrawalParams]);

  const tx = await (router.connect(signer) as any).multicall(
    [sendWntData, sendTokensData, createWithdrawalData],
    { value: executionFee, gasLimit: 4_000_000 }
  );
  const receipt = await tx.wait();
  if (process.env.GMX_DEBUG_EXEC_FEE === "1") {
    console.log(
      `[createWithdrawalForTest] chain=${getActiveChain()} requestedExecutionFee=${requestedExecutionFee.toString()} executionFee=${executionFee.toString()} value=${executionFee.toString()} status=${String(receipt.status)} logs=${receipt.logs?.length ?? 0} events=${(receipt as any).events?.length ?? 0}`
    );
  }
  let key: string;
  try {
    key = getEventKey(receipt, "WithdrawalCreated");
  } catch {
    const withdrawalCountAfter = await getListCount(WITHDRAWAL_LIST_KEY);
    if (withdrawalCountAfter > withdrawalCountBefore) {
      const recovered = await getLastListItem(WITHDRAWAL_LIST_KEY);
      if (recovered) {
        key = recovered;
      } else {
        throw new Error("WithdrawalCreated event missing and WITHDRAWAL_LIST latest key could not be recovered");
      }
    } else {
      throw new Error(
        `WithdrawalCreated event missing and WITHDRAWAL_LIST did not grow (before=${withdrawalCountBefore.toString()}, after=${withdrawalCountAfter.toString()})`
      );
    }
  }
  return { key, receipt };
}

export async function cancelWithdrawalForTest(signer: any, key: string): Promise<any> {
  // GMX enforces a 300-block time-lock before cancellation; advance past it.
  await network.provider.send("hardhat_mine", ["0x131"]); // 305 blocks
  const router = await ethers.getContractAt(LIFECYCLE_ROUTER_ABI, DEFAULT_EXCHANGE_ROUTER);
  const tx = await (router.connect(signer) as any).cancelWithdrawal(key, { gasLimit: 2_000_000 });
  return tx.wait();
}

export async function executeWithdrawalForTest(
  key: string,
  oracleParams: OracleParams
): Promise<any> {
  const keeperAddress = await resolveKeeper();
  await network.provider.send("hardhat_impersonateAccount", [keeperAddress]);
  await network.provider.send("hardhat_setBalance", [keeperAddress, "0x56BC75E2D63100000"]);
  try {
    const keeper = await ethers.getSigner(keeperAddress);
    const handler = await ethers.getContractAt(
      WITHDRAWAL_HANDLER_EXECUTE_ABI,
      DEFAULT_WITHDRAWAL_HANDLER
    );
    const tx = await (handler.connect(keeper) as any).executeWithdrawal(key, oracleParams, {
      gasLimit: 8_000_000
    });
    return tx.wait();
  } finally {
    await network.provider.send("hardhat_stopImpersonatingAccount", [keeperAddress]);
  }
}
