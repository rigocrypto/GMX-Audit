import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import https from "https";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { computeSeverity } from "./validateProof";
import { formatUsdFromCents, rawAmountToUsd } from "./utils/formatWei";
import { canonicalJson } from "./utils/canonicalJson";

export interface ProofEntry {
  file: string;
  proof_hash: string;
  dedupe_key: string;
  content_hash: string;
  eth_price_used: string;
  eth_price_source: "env" | "remote" | "fallback";
  chain: string;
  block: number;
  detector: string;
  userNet: string;
  poolNet: string;
  usd_user: string;
  usd_pool: string;
  usd_impact: string;
  severity: "Critical" | "High" | "Medium";
}

export interface TriageResult {
  schema_version: 1;
  scanned_at: string;
  eth_price_used: string;
  eth_price_source: "env" | "remote" | "fallback";
  triage_tool_version: string;
  proof_dir: string;
  total_proofs: number;
  has_critical: boolean;
  has_high: boolean;
  critical_count: number;
  high_count: number;
  medium_count: number;
  total_usd_impact: string;
  proofs: ProofEntry[];
  summary_text: string;
}

type EthPricing = {
  priceUsd: string;
  source: "env" | "remote" | "fallback";
};

function getTriageToolVersion(): string {
  try {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: string };
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

export function stableProofHash(input: { chain: string; block: number; detector: string }): string {
  const canonical = JSON.stringify({
    chain: input.chain,
    block: input.block,
    detector: input.detector
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function contentHash(proof: {
  chain: string;
  block: number;
  detector?: string;
  userNet: string;
  poolNet: string;
  txs?: unknown;
}): string {
  const normalizedTxs = Array.isArray(proof.txs)
    ? proof.txs.map((tx) => canonicalJson(tx)).sort()
    : [];

  const canonical = {
    chain: proof.chain,
    block: Number(proof.block),
    detector: proof.detector ?? "unknown",
    userNet: proof.userNet,
    poolNet: proof.poolNet,
    txs: normalizedTxs
  };

  return createHash("sha256").update(canonicalJson(canonical)).digest("hex").slice(0, 12);
}

function emptyResult(proofDir: string): TriageResult {
  return {
    scanned_at: new Date().toISOString(),
    schema_version: 1,
    eth_price_used: process.env.ETH_PRICE_USD || "3400",
    eth_price_source: "fallback",
    triage_tool_version: getTriageToolVersion(),
    proof_dir: proofDir,
    total_proofs: 0,
    has_critical: false,
    has_high: false,
    critical_count: 0,
    high_count: 0,
    medium_count: 0,
    total_usd_impact: "$0.00",
    proofs: [],
    summary_text: "No proofs detected."
  };
}

export function triageProofs(dir: string): TriageResult {
  const explicit = process.env.ETH_PRICE_USD;
  const source: "env" | "fallback" = explicit && explicit.trim() !== "" ? "env" : "fallback";
  return triageProofsWithPrice(dir, explicit || "3400", source);
}

export function triageProofsWithPrice(
  dir: string,
  ethPriceUsd: string,
  ethPriceSource: "env" | "remote" | "fallback"
): TriageResult {
  const proofDir = path.resolve(dir);
  if (!fs.existsSync(proofDir)) {
    const empty = emptyResult(proofDir);
    empty.eth_price_used = ethPriceUsd;
    empty.eth_price_source = ethPriceSource;
    return empty;
  }

  const schemaPath = path.resolve(process.cwd(), "schemas", "proof.schema.json");
  const schemaRaw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const entries: ProofEntry[] = [];
  const files = fs.readdirSync(proofDir).filter((f) => f.endsWith(".json") && !f.includes("gitkeep"));

  for (const file of files) {
    const fullPath = path.join(proofDir, file);
    try {
      const raw = fs.readFileSync(fullPath, "utf8");
      const proof = JSON.parse(raw) as {
        chain: string;
        block: number;
        detector?: string;
        userNet: string;
        poolNet: string;
        txs?: unknown;
      };

      if (!validate(proof)) {
        const errorText = ajv.errorsText(validate.errors, { separator: "; " });
        console.warn(`[triage] Skipping ${file}: schema validation failed (${errorText})`);
        continue;
      }

      const detector = proof.detector ?? "unknown";
      const usdUser = rawAmountToUsd(proof.userNet, ethPriceUsd);
      const usdPool = rawAmountToUsd(proof.poolNet, ethPriceUsd);

      entries.push({
        file,
        proof_hash: stableProofHash({ chain: proof.chain, block: Number(proof.block), detector }),
        dedupe_key: stableProofHash({ chain: proof.chain, block: Number(proof.block), detector }),
        content_hash: contentHash(proof),
        eth_price_used: ethPriceUsd,
        eth_price_source: ethPriceSource,
        chain: proof.chain,
        block: Number(proof.block),
        detector,
        userNet: proof.userNet,
        poolNet: proof.poolNet,
        usd_user: usdUser.display,
        usd_pool: usdPool.display,
        usd_impact: `${usdUser.display} user / ${usdPool.display} pool`,
        severity: computeSeverity({ userNet: proof.userNet, poolNet: proof.poolNet })
      });
    } catch (error) {
      console.warn(`[triage] Skipping ${file}: ${(error as Error).message}`);
    }
  }

  const order = { Critical: 0, High: 1, Medium: 2 };
  entries.sort((a, b) => order[a.severity] - order[b.severity]);

  const criticalCount = entries.filter((e) => e.severity === "Critical").length;
  const highCount = entries.filter((e) => e.severity === "High").length;
  const mediumCount = entries.filter((e) => e.severity === "Medium").length;
  const totalUsdImpact = entries.reduce((sum, entry) => {
    const userCents = rawAmountToUsd(entry.userNet, ethPriceUsd).value;
    const poolCents = rawAmountToUsd(entry.poolNet, ethPriceUsd).value;
    const userAbs = userCents < 0n ? -userCents : userCents;
    const poolAbs = poolCents < 0n ? -poolCents : poolCents;
    return sum + userAbs + poolAbs;
  }, 0n);

  const summaryLines: string[] = [
    `Triage complete: ${entries.length} proof(s) found.`,
    ...(criticalCount > 0 ? [`CRITICAL: ${criticalCount}`] : []),
    ...(highCount > 0 ? [`HIGH: ${highCount}`] : []),
    ...(mediumCount > 0 ? [`MEDIUM: ${mediumCount}`] : []),
    ...(entries.length > 0 ? [`USD impact (abs aggregate): ${formatUsdFromCents(totalUsdImpact)}`] : []),
    ...(entries.length === 0 ? ["No proofs detected."] : [])
  ];

  if (entries.length > 0) {
    summaryLines.push("", "Details:");
    for (const entry of entries) {
      summaryLines.push(
        `  [${entry.severity}] ${entry.chain} block ${entry.block} - ${entry.detector} (${entry.usd_impact}) | dedupe=${entry.dedupe_key} content=${entry.content_hash}`
      );
    }
  }

  return {
    schema_version: 1,
    scanned_at: new Date().toISOString(),
    eth_price_used: ethPriceUsd,
    eth_price_source: ethPriceSource,
    triage_tool_version: getTriageToolVersion(),
    proof_dir: proofDir,
    total_proofs: entries.length,
    has_critical: criticalCount > 0,
    has_high: highCount > 0,
    critical_count: criticalCount,
    high_count: highCount,
    medium_count: mediumCount,
    total_usd_impact: formatUsdFromCents(totalUsdImpact),
    proofs: entries,
    summary_text: summaryLines.join("\n")
  };
}

async function resolveEthPricing(): Promise<EthPricing> {
  const shouldFetch = process.env.FETCH_ETH_PRICE === "1";
  const explicit = process.env.ETH_PRICE_USD;
  if (!shouldFetch && explicit && explicit.trim() !== "") {
    return { priceUsd: explicit.trim(), source: "env" };
  }

  if (!shouldFetch) {
    return { priceUsd: "3400", source: "fallback" };
  }

  try {
    const payload = (await new Promise<{ ethereum?: { usd?: number } }>((resolve, reject) => {
      const req = https.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        {
          headers: {
            "User-Agent": "gmx-audit-triage/1.0"
          }
        },
        (res) => {
          if (res.statusCode === 429) {
            reject(new Error("eth price rate-limited (429)"));
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`eth price http ${res.statusCode ?? "unknown"}`));
            return;
          }

          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as { ethereum?: { usd?: number } });
            } catch (error) {
              reject(error as Error);
            }
          });
        }
      );

      req.setTimeout(3000, () => {
        req.destroy(new Error("eth price timeout"));
      });

      req.on("error", (error) => {
        reject(error);
      });
    })) as { ethereum?: { usd?: number } };

    const usd = payload?.ethereum?.usd;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      return { priceUsd: usd.toString(), source: "remote" };
    }
  } catch {
    // Fall back to deterministic default for CI stability.
  }

  if (explicit && explicit.trim() !== "") {
    return { priceUsd: explicit.trim(), source: "env" };
  }

  return { priceUsd: "3400", source: "fallback" };
}

if (require.main === module) {
  const main = async (): Promise<void> => {
    const args = process.argv.slice(2);
    const dIdx = args.indexOf("--dir");
    const outIdx = args.indexOf("--out");

    const dir = dIdx !== -1 && args[dIdx + 1] ? args[dIdx + 1] : "exploit-proofs";
    const outPath = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : undefined;
    const pricing = await resolveEthPricing();
    const result = triageProofsWithPrice(dir, pricing.priceUsd, pricing.source);

    console.log(result.summary_text);
    console.log(`[triage] eth_price_used=${result.eth_price_used} source=${result.eth_price_source}`);

    if (outPath) {
      const absoluteOut = path.resolve(outPath);
      fs.mkdirSync(path.dirname(absoluteOut), { recursive: true });
      fs.writeFileSync(absoluteOut, JSON.stringify(result, null, 2), "utf8");
      console.log(`\nTriage JSON -> ${absoluteOut}`);
    }

    if (process.env.CI || process.env.GITHUB_ACTIONS === "true") {
      process.exit(0);
    }

    process.exit(result.has_critical || result.has_high ? 1 : 0);
  };

  main().catch((error) => {
    console.error(`[triage] fatal: ${(error as Error).message}`);
    process.exit(2);
  });
}
