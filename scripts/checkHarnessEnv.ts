/**
 * Verify all environment keys and deployment artifacts required by the
 * test/gmx-invariants harness lifecycle helpers.
 *
 * Usage:   npx ts-node scripts/checkHarnessEnv.ts
 * Exit 0 = all good, Exit 1 = gaps found.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

function readDeploymentAddress(fileName: string): string | undefined {
  const p = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  try {
    const payload = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof payload.address === "string" && payload.address.length > 0
      ? payload.address
      : undefined;
  } catch {
    return undefined;
  }
}

interface CheckItem {
  label: string;
  envKey?: string;
  artifactFile?: string;
}
  interface CheckGroup {
    label: string;
    // One or more env keys — any match satisfies the group
    envKeys?: string[];
    artifactFile?: string;
    optional?: boolean;
  }

  const ITEMS: CheckGroup[] = [
    // ── RPC / fork  (accept either key spelling) ─────────────────
    { label: "Arbitrum RPC URL",  envKeys: ["ARBITRUM_RPC_URL", "ARBITRUM_RPC"] },
    { label: "Fork block",        envKeys: ["FORK_BLOCK", "FORK_BLOCK_NUMBER"] },
    // ── Core contracts ───────────────────────────────────────────
    { label: "ExchangeRouter",    envKeys: ["GMX_EXCHANGE_ROUTER_ADDRESS"], artifactFile: "ExchangeRouter.json" },
    { label: "Router",            envKeys: ["GMX_ROUTER_ADDRESS"],          artifactFile: "Router.json" },
    { label: "OrderVault",        envKeys: ["GMX_ORDER_VAULT_ADDRESS"],     artifactFile: "OrderVault.json" },
    { label: "DepositVault",      envKeys: ["GMX_DEPOSIT_VAULT_ADDRESS"],   artifactFile: "DepositVault.json" },
    { label: "DataStore",         envKeys: ["GMX_DATA_STORE_ADDRESS"],      artifactFile: "DataStore.json" },
    // ── Lifecycle helpers ────────────────────────────────────────
    { label: "OrderHandler",      envKeys: ["GMX_ORDER_HANDLER_ADDRESS"],      artifactFile: "OrderHandler.json" },
    { label: "WithdrawalVault",   envKeys: ["GMX_WITHDRAWAL_VAULT_ADDRESS"],   artifactFile: "WithdrawalVault.json" },
    { label: "WithdrawalHandler", envKeys: ["GMX_WITHDRAWAL_HANDLER_ADDRESS"], artifactFile: "WithdrawalHandler.json" },
    { label: "EventEmitter",      envKeys: ["GMX_EVENT_EMITTER_ADDRESS"],      artifactFile: "EventEmitter.json" },
    { label: "RoleStore",         envKeys: ["GMX_ROLE_STORE_ADDRESS"],         artifactFile: "RoleStore.json" },
    { label: "ChainlinkDSP",      envKeys: ["GMX_CHAINLINK_DATA_STREAM_PROVIDER_ADDRESS"], artifactFile: "ChainlinkDataStreamProvider.json" },
    // ── Optional (WARN if missing) ───────────────────────────────
    { label: "Keeper address (optional — auto-resolved from RoleStore)", envKeys: ["GMX_KEEPER_ADDRESS"], optional: true },
    { label: "Market address",    envKeys: ["GMX_MARKET_ADDRESS"] },
    { label: "Collateral token",  envKeys: ["GMX_COLLATERAL_TOKEN"] },
    { label: "Whale address",     envKeys: ["GMX_WHALE_ADDRESS"] },
  ];

let missing = 0;
let fallback = 0;
let present = 0;

for (const item of ITEMS) {
  const matchedEnv = item.envKeys?.find((k) => process.env[k]);
  const envVal = matchedEnv ? (process.env[matchedEnv] ?? "") : "";
  const artifactVal = item.artifactFile ? readDeploymentAddress(item.artifactFile) : undefined;

  if (envVal) {
    console.log(`OK  (env)      ${item.label} = ${envVal.slice(0, 14)}...`);
    present++;
  } else if (artifactVal) {
    console.log(`OK  (artifact) ${item.label} = ${artifactVal.slice(0, 14)}...`);
    fallback++;
  } else if (item.optional) {
    console.warn(`WARN (optional) ${item.label}`);
  } else {
    const note = item.envKeys?.length ? `Set ${item.envKeys[0]} in .env` : "no fallback";
    console.error(`MISS           ${item.label}  — ${note}`);
    missing++;
  }
}

console.log(
  `\n${present} from env, ${fallback} from artifacts, ${missing} missing.\n`
);

if (missing > 0) {
  console.error(`\n${missing} required keys missing. Add them to .env before running lifecycle helpers.`);
  process.exit(1);
}

console.log("All required keys present (env or artifact). Ready to run lifecycle helpers.");
