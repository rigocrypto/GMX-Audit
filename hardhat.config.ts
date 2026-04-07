import * as dotenv from "dotenv";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-verify";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const ARBITRUM_RPC =
  process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const AVALANCHE_RPC =
  process.env.AVALANCHE_RPC || process.env.AVALANCHE_RPC_URL || "https://avalanche.drpc.org";
const GMX_CHAIN = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();
const ACTIVE_RPC = GMX_CHAIN === "avalanche" ? AVALANCHE_RPC : ARBITRUM_RPC;
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
      ...(ACTIVE_RPC
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
