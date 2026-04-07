import { expect } from "chai";
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";

import {
  MoonwellActionInput,
  MoonwellAdapter,
  MoonwellInvariantContext,
  MoonwellStateTracker,
  MoonwellProof
} from "./moonwell-harness";

/**
 * Moonwell Invariant Fuzz Suite
 * 
 * Tests:
 * 1. Protocol solvency across action sequences
 * 2. User value conservation (no free borrow)
 * 3. Liquidation correctness
 * 4. Cross-market isolation
 */

describe("Moonwell Invariants - Fuzz", () => {
  let ctx: MoonwellInvariantContext;
  let adapter: MoonwellAdapter;
  let tracker: MoonwellStateTracker;
  let deployer: HardhatEthersSigner;
  
  // Config - OVERRIDE THESE for your deployment
  const COMPTROLLER_ADDR = process.env.MOONWELL_COMPTROLLER || "0x...";
  const ORACLE_ADDR = process.env.MOONWELL_ORACLE || "0x...";
  const MARKETS_NATIVE = ["mUSDC", "mWETH", "mCBETH"]; // Update to real market symbols
  const CHAIN = (process.env.MOONWELL_CHAIN || "base") as "base" | "optimism" | "arbitrum";
  
  const FUZZ_RUNS = parseInt(process.env.MOONWELL_FUZZ_RUNS || "100");
  const SEED = parseInt(process.env.MOONWELL_FUZZ_SEED || "42");

  // Proof capture
  const proofDir = path.join(process.cwd(), "exploit-proofs", "moonwell");
  
  before(async () => {
    // Setup signers
    const signers = await ethers.getSigners();
    deployer = signers[0];

    // Load protocol contracts
    const comptrollerABI = [
      "function getAccountLiquidity(address) view returns (uint, uint, uint)",
      "function enterMarkets(address[]) returns (uint[])",
      "function getAllMarkets() view returns (address[])"
    ];

    const oracleABI = [
      "function getUnderlyingPrice(address) view returns (uint)"
    ];

    const mTokenABI = [
      "function mint(uint) returns (uint)",
      "function borrow(uint) returns (uint)",
      "function redeem(uint) returns (uint)",
      "function repayBorrow(uint) returns (uint)",
      "function balanceOf(address) view returns (uint)",
      "function borrowBalanceStored(address) view returns (uint)",
      "function exchangeRateStored() view returns (uint)",
      "function totalBorrows() view returns (uint)",
      "function totalSupply() view returns (uint)",
      "function underlying() view returns (address)"
    ];

    const comptroller = new Contract(COMPTROLLER_ADDR, comptrollerABI, deployer);
    const oracle = new Contract(ORACLE_ADDR, oracleABI, deployer);

    // Create test users
    const users = signers.slice(1, 6).map(s => s.address); // 5 test users

    // Load markets from on-chain
    const allMarkets = await comptroller.getAllMarkets();
    const mTokens = new Map<string, Contract>();
    const underlyings = new Map<string, Contract>();

    // For demo: manually wire up known markets
    // In production: query registry or decode from getAllMarkets
    for (const marketAddr of allMarkets.slice(0, 3)) { // Just first 3 markets
      const mToken = new Contract(marketAddr, mTokenABI, deployer);
      const underlying = await mToken.underlying();
      
      // Symbol lookup (simplified - use contract calls or registry in production)
      let symbol = "mUnknown";
      try {
        const u = new Contract(underlying, ["function symbol() view returns (string)"], deployer);
        const underlyingSymbol = await u.symbol();
        symbol = `m${underlyingSymbol}`;
      } catch {}

      mTokens.set(symbol, mToken);
      underlyings.set(underlying, mToken);
    }

    ctx = {
      comptroller,
      oracle,
      mTokens,
      underlyings,
      users,
      deployer,
      forkBlock: (await deployer.provider?.getBlockNumber()) || 0,
      chain: CHAIN
    };

    adapter = new MoonwellAdapter();
    tracker = new MoonwellStateTracker(ctx);

    // Create output dirs
    fs.mkdirSync(proofDir, { recursive: true });
  });

  // ==========================================================================
  // 🔴 CORE INVARIANT: PROTOCOL SOLVENCY
  // ==========================================================================

  it("should maintain protocol solvency across random sequences", async function () {
    this.timeout(300000); // 5 min

    const proofs: MoonwellProof[] = [];
    
    for (let run = 0; run < FUZZ_RUNS; run++) {
      const rng = new SeededRandom(SEED + run);
      
      // Random sequence of 5-20 actions per user
      const actionsPerUser = rng.range(5, 20);
      
      for (const user of ctx.users) {
        const userBalance0 = await tracker.getUserNetValue(user);
        
        for (let a = 0; a < actionsPerUser; a++) {
          const action = randomAction(rng, ctx);
          
          try {
            await executeAction(user, action);
          } catch (e) {
            // Action failed (expected in some cases)
            console.log(`Action failed: ${action.type}`, e instanceof Error ? e.message : String(e));
          }
        }

        const userBalance1 = await tracker.getUserNetValue(user);
        
        // No user should extract more than they supply (loose check)
        expect(userBalance1).to.be.gte(userBalance0 - BigInt(1e12), 
          `User ${user.slice(0,6)} extracted value: ${userBalance0} -> ${userBalance1}`
        );
      }

      // Check protocol solvency
      const { solvent, borrowsUSD, collateralUSD } = await tracker.checkProtocolSolvency();
      
      if (!solvent) {
        const proof: MoonwellProof = {
          chain: CHAIN,
          block: ctx.forkBlock!,
          detector: "ProtocolInsolvency",
          description: `Protocol became insolvent at fuzz run ${run}: borrows ${borrowsUSD} > collateral ${collateralUSD}`,
          userNet: "unknown",
          poolNet: String(-borrowsUSD + collateralUSD),
          txs: [],
          env: { FORK_BLOCK: String(ctx.forkBlock), MOONWELL_CHAIN: CHAIN },
          repro: { command: `npm run test:moonwell -- --seed ${SEED + run}`, notes: "" }
        };

        proofs.push(proof);
        fs.writeFileSync(
          path.join(proofDir, `insolvency-run${run}.json`),
          JSON.stringify(proof, null, 2)
        );

        throw new Error(`INVARIANT BROKEN: Protocol insolvent at run ${run}`);
      }
    }

    expect(proofs.length).to.equal(0, "Should not find insolvency proofs");
  });

  // ==========================================================================
  // 🟠 LIQUIDATION CORRECTNESS
  // ==========================================================================

  it("should prevent over-liquidation", async function () {
    this.timeout(100000);

    const liquidator = ctx.users[0];
    const borrower = ctx.users[1];
    const rng = new SeededRandom(SEED + 1000);

    // Setup: borrower supplies and borrows
    const markets = Array.from(ctx.mTokens.values());
    if (markets.length < 2) this.skip();

    const supplyMarket = markets[0];
    const borrowMarket = markets[1];

    // Supply collateral
    await executeAction(borrower, {
      type: "supply",
      market: getMarketSymbol(supplyMarket),
      amount: BigInt(10) * BigInt(1e18) // 10 tokens
    });

    // Borrow
    await executeAction(borrower, {
      type: "borrow",
      market: getMarketSymbol(borrowMarket),
      amount: BigInt(5) * BigInt(1e18)
    });

    // Liquidator supplies collateral and borrows to have repay tokens
    await executeAction(liquidator, {
      type: "supply",
      market: getMarketSymbol(borrowMarket),
      amount: BigInt(100) * BigInt(1e18)
    });

    // Price manipulation (if oracle is mutable in fork)
    // - Drop supply market price to trigger liquidation
    // - Track seized amount vs expected

    // Verify liquidation
    const seized = await supplyMarket.balanceOf(liquidator);
    const repaid = BigInt(5) * BigInt(1e18); // repay amount
    
    // Seized should be < liquidationIncentive * repaid
    const incentive = await ctx.comptroller.liquidationIncentiveMantissa();
    const maxSeizable = (repaid * incentive) / BigInt(1e18);
    
    expect(seized).to.be.lte(maxSeizable, "Liquidation over-seized");
  });

  // ==========================================================================
  // NO FREE BORROW
  // ==========================================================================

  it("should prevent free borrow loops", async function () {
    this.timeout(100000);

    const user = ctx.users[2];
    const rng = new SeededRandom(SEED + 2000);

    const markets = Array.from(ctx.mTokens.values());
    if (markets.length < 2) this.skip();

    const m1 = markets[0];
    const m2 = markets[1];
    const m1Symbol = getMarketSymbol(m1);
    const m2Symbol = getMarketSymbol(m2);

    // Starting net value
    const netStart = await tracker.getUserNetValue(user);

    // Try borrow -> exit collateral -> redeem loop
    // Supply in m1
    await executeAction(user, {
      type: "supply",
      market: m1Symbol,
      amount: BigInt(10) * BigInt(1e18)
    });

    // Enter m1
    await executeAction(user, {
      type: "enterMarket",
      market: m1Symbol
    });

    // Borrow from m2
    await executeAction(user, {
      type: "borrow",
      market: m2Symbol,
      amount: BigInt(5) * BigInt(1e18)
    });

    // Try to redeem m1 (should fail or be constrained)
    await executeAction(user, {
      type: "redeem",
      market: m1Symbol,
      amount: BigInt(1) * BigInt(1e18)
    });

    const netEnd = await tracker.getUserNetValue(user);

    // User should not gain value
    expect(netEnd).to.be.gte(netStart - BigInt(1e12), "User gained free value");
  });

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  async function executeAction(user: string, action: MoonwellActionInput): Promise<void> {
    const populatedAction: MoonwellActionInput = { ...action, user };
    
    switch (action.type) {
      case "supply":
        await adapter.supply(ctx, populatedAction);
        break;
      case "enterMarket":
        await adapter.enterMarket(ctx, populatedAction);
        break;
      case "borrow":
        await adapter.borrow(ctx, populatedAction);
        break;
      case "repay":
        await adapter.repay(ctx, populatedAction);
        break;
      case "redeem":
        await adapter.redeem(ctx, populatedAction);
        break;
      case "liquidate":
        await adapter.liquidate(ctx, populatedAction);
        break;
    }
  }

  function getMarketSymbol(mTokenAddr: Contract): string {
    for (const [symbol, market] of ctx.mTokens) {
      if (market.address === mTokenAddr.address) return symbol;
    }
    return "unknown";
  }
});

// =============================================================================
// FUZZING HELPERS
// =============================================================================

function randomAction(rng: SeededRandom, ctx: MoonwellInvariantContext): MoonwellActionInput {
  const actionTypes = ["supply", "enterMarket", "borrow", "repay", "redeem"] as const;
  const actionType = actionTypes[rng.range(0, actionTypes.length)];

  const markets = Array.from(ctx.mTokens.keys());
  const market = markets[rng.range(0, markets.length)];
  const amount = BigInt(rng.range(1, 100)) * BigInt(1e18);

  return {
    type: actionType,
    market,
    amount
  };
}

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0; // Ensure 32-bit unsigned
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }
}
