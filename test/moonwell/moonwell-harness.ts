import { Contract, ContractTransactionResponse, Signer, ethers } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * MoonwellInvariant Harness
 * 
 * Adapted from GMX harness for Compound-fork lending protocol.
 * Supports deterministic fork-based testing with invariant hunting.
 */

// =============================================================================
// TYPES
// =============================================================================

export type MoonwellActionType = 
  | "supply"
  | "enterMarket"
  | "borrow"
  | "repay"
  | "redeem"
  | "liquidate"
  | "priceChange";

export interface MoonwellActionInput {
  type: MoonwellActionType;
  user?: string;
  market?: string;       // mToken address
  amount?: bigint;
  repayMarket?: string;  // for liquidation: what to repay
  seizeMarket?: string;  // for liquidation: what to seize
  priceChange?: {        // for oracle manipulation in fork
    market: string;
    newPrice: bigint;
  };
}

export interface UserState {
  suppliedMarkets: Map<string, { mTokens: bigint; underlying: bigint }>;
  borrowedMarkets: Map<string, bigint>;
  accountLiquidity: { liquidity: bigint; shortfall: bigint };
  netValueUSD: bigint;
}

export interface MarketState {
  mToken: string;
  underlying: string;
  totalSupply: bigint;
  totalBorrows: bigint;
  exchangeRate: bigint;
  borrowIndex: bigint;
  cash: bigint;
  price: bigint;
}

export interface MoonwellSnapshot {
  timestamp: number;
  blockNumber: number;
  markets: Map<string, MarketState>;
  users: Map<string, UserState>;
}

// =============================================================================
// MINIMAL ABI CONSTANTS
// =============================================================================

const IERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)"
];

const MTOKEN_ABI = [
  "function mint(uint256) returns (uint256)",
  "function redeem(uint256) returns (uint256)",
  "function redeemUnderlying(uint256) returns (uint256)",
  "function borrow(uint256) returns (uint256)",
  "function repayBorrow(uint256) returns (uint256)",
  "function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)",
  "function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function underlying() view returns (address)",
  "function borrowIndex() view returns (uint256)",
  "function accrualBlockNumber() view returns (uint256)"
];

const COMPTROLLER_ABI = [
  "function enterMarkets(address[]) returns (uint256[])",
  "function exitMarket(address) returns (uint256)",
  "function getAccountLiquidity(address) view returns (uint256, uint256, uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  "function closeFactorMantissa() view returns (uint256)",
  "function getAllMarkets() view returns (address[])",
  "function markets(address) view returns (bool isListed, uint collateralFactorMantissa, bool isComped)"
];

const ORACLE_ABI = [
  "function getUnderlyingPrice(address mToken) view returns (uint256)"
];

// =============================================================================
// MOONWELL CONTEXT & ADAPTER
// =============================================================================

export interface MoonwellInvariantContext {
  comptroller: Contract;
  oracle: Contract;
  mTokens: Map<string, Contract>;      // symbol -> mToken contract
  underlyings: Map<string, Contract>;  // underlying address -> ERC20
  users: string[];
  deployer: HardhatEthersSigner;
  forkBlock?: number;
  chain: "base" | "optimism" | "arbitrum";
}

export interface MoonwellActionAdapter {
  supply(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
  enterMarket(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
  borrow(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
  repay(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
  redeem(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
  liquidate(ctx: MoonwellInvariantContext, input: MoonwellActionInput): Promise<{ tx?: ContractTransactionResponse; returnCode: number }>;
}

// =============================================================================
// ACTION IMPLEMENTATIONS
// =============================================================================

export class MoonwellAdapter implements MoonwellActionAdapter {
  /**
   * Supply underlying token to mToken
   */
  async supply(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, market, amount } = input;
    
    if (!user || !market || !amount) {
      throw new Error("supply: missing user, market, or amount");
    }

    try {
      const mToken = ctx.mTokens.get(market);
      if (!mToken) throw new Error(`supply: unknown market ${market}`);

      const underlyingAddr = await mToken.underlying();
      const underlying = new Contract(underlyingAddr, IERC20_ABI, ctx.deployer);

      // Approve
      await underlying.approve(mToken.address, amount, { from: user });

      // Mint
      const tx = await mToken.mint(amount, { from: user });
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("supply error:", e);
      return { returnCode: 1 };
    }
  }

  /**
   * Enter market (enable collateral usage)
   */
  async enterMarket(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, market } = input;
    
    if (!user || !market) {
      throw new Error("enterMarket: missing user or market");
    }

    try {
      const mToken = ctx.mTokens.get(market);
      if (!mToken) throw new Error(`enterMarket: unknown market ${market}`);

      const tx = await ctx.comptroller.enterMarkets([mToken.address], { from: user });
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("enterMarket error:", e);
      return { returnCode: 1 };
    }
  }

  /**
   * Borrow from market
   */
  async borrow(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, market, amount } = input;
    
    if (!user || !market || !amount) {
      throw new Error("borrow: missing user, market, or amount");
    }

    try {
      const mToken = ctx.mTokens.get(market);
      if (!mToken) throw new Error(`borrow: unknown market ${market}`);

      const tx = await mToken.borrow(amount, { from: user });
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("borrow error:", e);
      return { returnCode: 1 };
    }
  }

  /**
   * Repay borrow
   */
  async repay(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, market, amount } = input;
    
    if (!user || !market || !amount) {
      throw new Error("repay: missing user, market, or amount");
    }

    try {
      const mToken = ctx.mTokens.get(market);
      if (!mToken) throw new Error(`repay: unknown market ${market}`);

      const underlyingAddr = await mToken.underlying();
      const underlying = new Contract(underlyingAddr, IERC20_ABI, ctx.deployer);

      // Approve
      await underlying.approve(mToken.address, amount, { from: user });

      // Repay
      const tx = await mToken.repayBorrow(amount, { from: user });
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("repay error:", e);
      return { returnCode: 1 };
    }
  }

  /**
   * Redeem mToken for underlying
   */
  async redeem(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, market, amount } = input;
    
    if (!user || !market || !amount) {
      throw new Error("redeem: missing user, market, or amount");
    }

    try {
      const mToken = ctx.mTokens.get(market);
      if (!mToken) throw new Error(`redeem: unknown market ${market}`);

      // amount = mToken units to redeem
      const tx = await mToken.redeem(amount, { from: user });
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("redeem error:", e);
      return { returnCode: 1 };
    }
  }

  /**
   * Liquidate borrower
   */
  async liquidate(
    ctx: MoonwellInvariantContext,
    input: MoonwellActionInput
  ): Promise<{ tx?: ContractTransactionResponse; returnCode: number }> {
    const { user, repayMarket, seizeMarket, amount } = input;
    
    if (!user || !repayMarket || !seizeMarket || !amount) {
      throw new Error("liquidate: missing user, repayMarket, seizeMarket, or amount");
    }

    try {
      const repayMToken = ctx.mTokens.get(repayMarket);
      const seizeMToken = ctx.mTokens.get(seizeMarket);
      
      if (!repayMToken || !seizeMToken) {
        throw new Error("liquidate: unknown market");
      }

      const underlyingAddr = await repayMToken.underlying();
      const underlying = new Contract(underlyingAddr, IERC20_ABI, ctx.deployer);

      // Approve repay amount
      await underlying.approve(repayMToken.address, amount, { from: user });

      // Liquidate
      const tx = await repayMToken.liquidateBorrow(
        user,
        amount,
        seizeMToken.address,
        { from: user }
      );
      
      return { tx: tx as ContractTransactionResponse, returnCode: 0 };
    } catch (e) {
      console.error("liquidate error:", e);
      return { returnCode: 1 };
    }
  }
}

// =============================================================================
// STATE TRACKING & SNAPSHOTS
// =============================================================================

export class MoonwellStateTracker {
  constructor(private ctx: MoonwellInvariantContext) {}

  async captureSnapshot(): Promise<MoonwellSnapshot> {
    const blockNumber = await this.ctx.deployer.provider!.getBlockNumber();
    const markets = new Map<string, MarketState>();
    const users = new Map<string, UserState>();

    // Capture market state
    for (const [symbol, mToken] of this.ctx.mTokens) {
      const totalSupply = await mToken.totalSupply();
      const totalBorrows = await mToken.totalBorrows();
      const exchangeRate = await mToken.exchangeRateStored();
      const borrowIndex = await mToken.borrowIndex();
      const cash = await mToken.getCash();
      const underlyingAddr = await mToken.underlying();

      const price = await this.ctx.oracle.getUnderlyingPrice(mToken.address);

      markets.set(symbol, {
        mToken: mToken.address,
        underlying: underlyingAddr,
        totalSupply,
        totalBorrows,
        exchangeRate,
        borrowIndex,
        cash,
        price
      });
    }

    // Capture user state
    for (const user of this.ctx.users) {
      const [err, liquidity, shortfall] = await this.ctx.comptroller.getAccountLiquidity(user);

      const suppliedMarkets = new Map<string, { mTokens: bigint; underlying: bigint }>();
      const borrowedMarkets = new Map<string, bigint>();
      let netValueUSD = 0n;

      for (const [symbol, mToken] of this.ctx.mTokens) {
        const balance = await mToken.balanceOf(user);
        const borrowBalance = await mToken.borrowBalanceStored(user);
        const exchangeRate = await mToken.exchangeRateStored();
        const price = markets.get(symbol)!.price;

        const underlying = (balance * exchangeRate) / BigInt(1e18);
        
        if (balance > 0n) {
          suppliedMarkets.set(symbol, { mTokens: balance, underlying });
          netValueUSD += (underlying * price) / BigInt(1e18);
        }

        if (borrowBalance > 0n) {
          borrowedMarkets.set(symbol, borrowBalance);
          netValueUSD -= (borrowBalance * price) / BigInt(1e18);
        }
      }

      users.set(user, {
        suppliedMarkets,
        borrowedMarkets,
        accountLiquidity: { liquidity, shortfall },
        netValueUSD
      });
    }

    return {
      timestamp: Date.now(),
      blockNumber,
      markets,
      users
    };
  }

  /**
   * User net value: supplied - borrowed (in USD)
   */
  async getUserNetValue(user: string): Promise<bigint> {
    let netValue = 0n;

    for (const [_, mToken] of this.ctx.mTokens) {
      const balance = await mToken.balanceOf(user);
      const borrowBalance = await mToken.borrowBalanceStored(user);
      const exchangeRate = await mToken.exchangeRateStored();
      const price = await this.ctx.oracle.getUnderlyingPrice(mToken.address);

      const underlying = (balance * exchangeRate) / BigInt(1e18);

      netValue += (underlying * price) / BigInt(1e18);
      netValue -= (borrowBalance * price) / BigInt(1e18);
    }

    return netValue;
  }

  /**
   * Protocol insolvency check: total borrows <= total collateral
   */
  async checkProtocolSolvency(): Promise<{ solvent: boolean; borrowsUSD: bigint; collateralUSD: bigint }> {
    let borrowsUSD = 0n;
    let collateralUSD = 0n;

    for (const [_, mToken] of this.ctx.mTokens) {
      const totalBorrows = await mToken.totalBorrows();
      const totalSupply = await mToken.totalSupply();
      const exchangeRate = await mToken.exchangeRateStored();
      const price = await this.ctx.oracle.getUnderlyingPrice(mToken.address);

      borrowsUSD += (totalBorrows * price) / BigInt(1e18);
      const underlying = (totalSupply * exchangeRate) / BigInt(1e18);
      collateralUSD += (underlying * price) / BigInt(1e18);
    }

    return {
      solvent: borrowsUSD <= collateralUSD,
      borrowsUSD,
      collateralUSD
    };
  }
}

// =============================================================================
// PROOF FORMAT (reuse existing GMX proof schema)
// =============================================================================

export interface MoonwellProof {
  chain: "base" | "optimism" | "arbitrum";
  block: number;
  detector: string;
  description: string;
  
  // Economics
  userNet: string;        // wei change to attacker net value
  poolNet: string;        // wei change to protocol net value
  
  // Reproduction
  txs: Array<{ hash: string; to: string; desc: string }>;
  env: { FORK_BLOCK: string; MOONWELL_CHAIN: string };
  repro: { command: string; notes: string };
}
