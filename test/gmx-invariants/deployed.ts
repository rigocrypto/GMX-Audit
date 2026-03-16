const CHAIN = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();

const ARBITRUM_DEFAULTS = {
  vault: "0x489ee077994B6658eAfA855C308275EAd8097C4A",
  exchangeRouter: "0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41",
  market: "0x70d95587d40A2caf56bd97485aB3Eec10Bee6336",
  collateralToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" // USDC
};

const AVALANCHE_DEFAULTS = {
  vault: "0x9ab2De34A33fB459b538c43f251eB825645e8595",
  exchangeRouter: "0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2",
  market: "0x913C1F46b48b3eD35E7dc3Cf754d4ae8499F31CF",
  collateralToken: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7" // WAVAX
};

const defaults = CHAIN === "avalanche" ? AVALANCHE_DEFAULTS : ARBITRUM_DEFAULTS;

function pickChainAwareEnv(name: string): string | undefined {
  if (CHAIN !== "avalanche") {
    return process.env[name];
  }
  return process.env[`${name}_AVALANCHE`] || process.env[`AVALANCHE_${name}`];
}

export const DEFAULT_DEPLOYED = {
  vault: pickChainAwareEnv("GMX_VAULT_ADDRESS") || defaults.vault,
  exchangeRouter: pickChainAwareEnv("GMX_EXCHANGE_ROUTER_ADDRESS") || defaults.exchangeRouter,
  market: pickChainAwareEnv("GMX_MARKET_ADDRESS") || defaults.market,
  collateralToken: pickChainAwareEnv("GMX_COLLATERAL_TOKEN") || defaults.collateralToken,
  impersonationWhale: process.env.GMX_WHALE_ADDRESS || ""
} as const;
