/**
 * Moonwell Configuration
 * 
 * Chainwise deployment addresses and market metadata.
 * Integrates with the bounty-rotation-harness proof system.
 */

export interface MoonwellDeployment {
  chain: "base" | "optimism" | "arbitrum";
  comptroller: string;
  oracle: string;
  markets: MarketConfig[];
  priceRegistry?: string;  // Chainlink or Redstone price feed registry
}

export interface MarketConfig {
  symbol: string;           // e.g., "mUSDC", "mWETH"
  mTokenAddress: string;
  underlyingAddress: string;
  underlyingSymbol: string;
  underlyingDecimals: number;
  collateralFactor: string; // Mantissa (1e18 scale)
  isListed: boolean;
}

// =============================================================================
// PRODUCTION DEPLOYMENTS
// =============================================================================

export const MOONWELL_BASE: MoonwellDeployment = {
  chain: "base",
  comptroller: "0xfB3466137f69dFDD48E9d2e93C6e50fc9671D68b", // Unitroller proxy
  oracle: "0x2E2466cE3A98f32d5Cb1a4c0Abe75e0Ac38c9b72", // ChainlinkOracle
  priceRegistry: "0x7c2eA10D641e7A1A413c2C47c1a17284ec09088D",
  
  markets: [
    {
      symbol: "mUSDC",
      mTokenAddress: "0xEdc817A28E8B93B03976FBd4623ddc4A7RL5af8e",
      underlyingAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b1bdDA5B4C3",
      underlyingSymbol: "USDC",
      underlyingDecimals: 6,
      collateralFactor: "850000000000000000", // 85% (0.85e18)
      isListed: true
    },
    {
      symbol: "mWETH",
      mTokenAddress: "0xd5D86FC8d5C0ea1ac1aC5dfBdBAC54B498E8E9d1",
      underlyingAddress: "0x4200000000000000000000000000000000000006",
      underlyingSymbol: "WETH",
      underlyingDecimals: 18,
      collateralFactor: "750000000000000000", // 75%
      isListed: true
    },
    {
      symbol: "mCBETH",
      mTokenAddress: "0x2Dd45523e4904b3DA5fC78e5303fC537f64B47652",
      underlyingAddress: "0x2Ae3F1Ec7F1F5012CFEab0411dBEEC30b67Fcab9",
      underlyingSymbol: "cbETH",
      underlyingDecimals: 18,
      collateralFactor: "700000000000000000", // 70%
      isListed: true
    },
    {
      symbol: "mUSDe",
      mTokenAddress: "0x5d916980D5C1237D9020107F00E9C1cB0a0B77C2",
      underlyingAddress: "0x0b3185F0666f63eCb77f3cAEf13e5316a97E4b17",
      underlyingSymbol: "USDe",
      underlyingDecimals: 18,
      collateralFactor: "700000000000000000", // 70%
      isListed: true
    },
    {
      symbol: "mDAI",
      mTokenAddress: "0x98e6B84Bf79d0fd41C6e06d706e07d5230ab0A5d",
      underlyingAddress: "0x50c5725949A6F0c72B6c40f5957C41DB4D64d365",
      underlyingSymbol: "DAI",
      underlyingDecimals: 18,
      collateralFactor: "750000000000000000", // 75%
      isListed: true
    }
  ]
};

export const MOONWELL_OPTIMISM: MoonwellDeployment = {
  chain: "optimism",
  comptroller: "0xFBb21d0380fcE2f3692e7e93585e8a7Ec4991cAD",
  oracle: "0x5b4d7b6eb3f0e90cBef8ceEaCDe1f4B3Cc62AF1",
  
  markets: [
    {
      symbol: "mUSDC",
      mTokenAddress: "0x5eA8eEaCf5a2c4f9C9e96cFDw3af9Q0z5Kw8Rt3xZ",
      underlyingAddress: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
      underlyingSymbol: "USDC.e",
      underlyingDecimals: 6,
      collateralFactor: "850000000000000000",
      isListed: true
    }
    // Add more OP markets as needed
  ]
};

export const MOONWELL_ARBITRUM: MoonwellDeployment = {
  chain: "arbitrum",
  comptroller: "0x6265D5b6C6D6a8C6dcA0FA3Zd4e1d0c0f0e0a00",
  oracle: "0x1234567890123456789012345678901234567890",
  
  markets: [
    {
      symbol: "mUSDC",
      mTokenAddress: "0x1234567890123456789012345678901234567890",
      underlyingAddress: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5F86",
      underlyingSymbol: "USDC",
      underlyingDecimals: 6,
      collateralFactor: "850000000000000000",
      isListed: true
    }
    // Add more ARB markets as needed
  ]
};

// =============================================================================
// ENVIRONMENT-BASED SELECTION
// =============================================================================

export function getDeployment(): MoonwellDeployment {
  const chain = (process.env.MOONWELL_CHAIN || "base") as "base" | "optimism" | "arbitrum";
  
  switch (chain) {
    case "base":
      return MOONWELL_BASE;
    case "optimism":
      return MOONWELL_OPTIMISM;
    case "arbitrum":
      return MOONWELL_ARBITRUM;
    default:
      throw new Error(`Unknown chain: ${chain}`);
  }
}

// =============================================================================
// RISK PROFILE PRESETS
// =============================================================================

export const RISK_PROFILES = {
  conservative: {
    maxBorrowPercentage: 0.5,        // Max borrow 50% of collateral
    liquidationThreshold: 0.85,       // Liquidate at 85% collateral usage
    testSequenceLength: 5
  },
  aggressive: {
    maxBorrowPercentage: 0.95,        // Max borrow 95%
    liquidationThreshold: 0.95,
    testSequenceLength: 20
  },
  extreme: {
    maxBorrowPercentage: 1.0,         // Max borrow 100%
    liquidationThreshold: 1.0,
    testSequenceLength: 50
  }
} as const;

// =============================================================================
// COMMON ATTACK PATTERNS (for directed fuzzing)
// =============================================================================

export const ATTACK_SEQUENCES = {
  /**
   * Classic: supply → borrow → exit → redeem
   * Try to escape with borrowed funds
   */
  collateralEscape: [
    { type: "supply", market: "mUSDC", amountPct: 0.8 },
    { type: "enterMarket", market: "mUSDC" },
    { type: "borrow", market: "mWETH", amountPct: 0.7 },
    { type: "exitMarket", market: "mUSDC" },
    { type: "redeem", market: "mUSDC", amountPct: 0.9 }
  ],

  /**
   * Flash borrow (if supported)
   */
  flashBorrow: [
    { type: "borrow", market: "mUSDC", amountPct: 0.99 },
    { type: "supply", market: "mWETH", amountPct: 0.5 },
    { type: "borrow", market: "mWETH", amountPct: 0.5 },
    { type: "repay", market: "mUSDC", amountPct: 1.0 }
  ],

  /**
   * Cross-market liquidation cascade
   */
  liquidationCascade: [
    { type: "supply", market: "mCBETH", amountPct: 0.5 },
    { type: "enterMarket", market: "mCBETH" },
    { type: "borrow", market: "mUSDC", amountPct: 0.7 },
    { type: "priceChange", market: "mCBETH", newPrice: 0.5 }, // Price crash
    { type: "liquidate", borrower: "user0", repayMarket: "mUSDC", seizeMarket: "mCBETH" }
  ],

  /**
   * Rounding abuse + interest accrual
   */
  roundingAbuse: [
    { type: "supply", market: "mDAI", amountPct: 0.99 },
    { type: "borrow", market: "mUSDC", amountPct: 0.01 },
    { type: "repay", market: "mUSDC", amount: 1 }, // Minimal repay
    { type: "redeem", market: "mDAI", amount: 1 }, // Minimal redeem
    { type: "borrow", market: "mUSDC", amountPct: 0.02 } // Borrow again
  ],

  /**
   * Market exit while indebted
   */
  indebted_exit: [
    { type: "supply", market: "mUSDC", amountPct: 1.0 },
    { type: "enterMarket", market: "mUSDC" },
    { type: "borrow", market: "mWETH", amountPct: 0.5 },
    { type: "exitMarket", market: "mUSDC" },
    { type: "redeem", market: "mUSDC", amountPct: 1.0 }
  ]
};

// =============================================================================
// PROOF SUBMISSION SETTINGS
// =============================================================================

export const PROOF_SETTINGS = {
  outputDir: "exploit-proofs/moonwell",
  historyDb: "outputs/metrics/moonwell-results.db",
  dashboardPath: "outputs/metrics/moonwell-dashboard.html",
  
  // Severity scoring
  severityThresholds: {
    critical: { maxPoolLoss: -1_000_000, minUserGain: 100_000 }, // Loss > $1M
    high: { maxPoolLoss: -100_000, minUserGain: 10_000 },        // Loss > $100k
    medium: { maxPoolLoss: -10_000, minUserGain: 1_000 }        // Loss > $10k
  },

  // Report generation
  immunefiTemplate: `
# Moonwell Protocol Vulnerability Report

## Summary
[auto-filled from proof]

## Impact
- Protocol Loss: $[poolNet]
- Attacker Gain: $[userNet]

## Reproduction
\`\`\`bash
${`npm run test:moonwell -- --seed [seed]`}
\`\`\`

## Technical Details
[steps from proof.txs]

## Remediation
[to be filled by human reviewer]
  `
};

// =============================================================================
// FORK TESTING SETTINGS
// =============================================================================

export const FORK_SETTINGS = {
  // Default block for fork (will be overridden by MOONWELL_FORK_BLOCK env)
  defaultBlock: {
    base: 18_000_000,
    optimism: 120_000_000,
    arbitrum: 200_000_000
  },

  // RPC endpoints (fallback; prefer .env)
  rpc: {
    base: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    optimism: process.env.OP_RPC_URL || "https://mainnet.optimism.io",
    arbitrum: process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc"
  },

  // Impersonation accounts (for testing)
  impersonationAccounts: {
    base: [
      "0x1111111111111111111111111111111111111111", // Test user 1
      "0x2222222222222222222222222222222222222222"  // Test user 2
    ]
  }
};

// =============================================================================
// EXPORT HELPERS
// =============================================================================

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  const deployment = getDeployment();
  return deployment.markets.find(m => m.symbol === symbol);
}

export function getAllMarkets(): MarketConfig[] {
  return getDeployment().markets;
}
