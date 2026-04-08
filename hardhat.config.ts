import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";

function loadOptionalPlugin(pluginName: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(pluginName);
  } catch (error) {
    const isMissingModule =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "MODULE_NOT_FOUND";

    const message = error instanceof Error ? error.message : "";
    const missingRequestedPlugin = message.includes(`'${pluginName}'`) || message.includes(pluginName);

    if (!isMissingModule || !missingRequestedPlugin) {
      throw error;
    }
  }
}

// Load supported plugins if present; avoid hard failure in CI if a plugin is unavailable.
loadOptionalPlugin("@nomicfoundation/hardhat-chai-matchers");
loadOptionalPlugin("@nomicfoundation/hardhat-ethers");
loadOptionalPlugin("@nomicfoundation/hardhat-network-helpers");
loadOptionalPlugin("@nomicfoundation/hardhat-verify");

dotenv.config();

const ARBITRUM_RPC =
  process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const AVALANCHE_RPC =
  process.env.AVALANCHE_RPC || process.env.AVALANCHE_RPC_URL || "https://avalanche.drpc.org";
const GMX_CHAIN = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();
const ACTIVE_RPC = GMX_CHAIN === "avalanche" ? AVALANCHE_RPC : ARBITRUM_RPC;
const HARDHAT_DISABLE_FORKING = process.env.HARDHAT_DISABLE_FORKING === "1";
const FORK_BLOCK_NUMBER =
  GMX_CHAIN === "avalanche"
    ? process.env.AVALANCHE_FORK_BLOCK
      ? Number(process.env.AVALANCHE_FORK_BLOCK)
      : process.env.AVALANCHE_FORK_BLOCK_NUMBER
      ? Number(process.env.AVALANCHE_FORK_BLOCK_NUMBER)
      : process.env.FORK_BLOCK
      ? Number(process.env.FORK_BLOCK)
      : undefined
    : process.env.FORK_BLOCK
    ? Number(process.env.FORK_BLOCK)
    : process.env.ARBITRUM_FORK_BLOCK_NUMBER
    ? Number(process.env.ARBITRUM_FORK_BLOCK_NUMBER)
    : undefined;

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  mocha: {
    timeout: 120000
  },
  networks: {
    hardhat: {
      chainId: 31337,
      chains: {
        42161: {
          hardforkHistory: {
            london: 0,
            merge: 0,
            shanghai: 0,
            cancun: 0
          }
        },
        43114: {
          hardforkHistory: {
            london: 0,
            merge: 0,
            shanghai: 0,
            cancun: 0
          }
        }
      },
      ...(!HARDHAT_DISABLE_FORKING && ACTIVE_RPC
        ? {
            forking: {
              enabled: true,
              url: ACTIVE_RPC,
              ...(FORK_BLOCK_NUMBER ? { blockNumber: FORK_BLOCK_NUMBER } : {})
            }
          }
        : {})
    }
  }
};

export default config;
