const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROMPT_VERSION = "1.2";

const PROMPT_TEMPLATE = `You are a DeFi security auditor specializing in GMX Vaults. Analyze the provided audit bundle and produce structured triage output.

INPUT DATA (JSON summaries only, do not hallucinate):
- Manifest: {MANIFEST_SUMMARY}
- Token Audit: {AUDIT_SUMMARY} (top 10 risky tokens by riskScore)
- Normalized Findings: {NORMALIZED_FINDINGS} (Slither/Mythril/custom)
- Vault Bytecode Hash: {BYTECODE_HASH}
- Source Files (excerpts): {SOURCE_EXCERPTS} (if available)

TASKS (output ONLY valid JSON, no other text):
1. Cross-correlate findings into 1-5 root cause hypotheses.
2. Identify GMX/Vault risks: oracle staleness impact, whitelist manipulation, poolAmounts precision loss.
3. Suggest 3-5 Foundry invariant tests (exact Solidity code snippets).
4. Prioritize manual review: top 3 files/functions/lines.
5. Rate overall vault risk: LOW/MEDIUM/HIGH + confidence (1-10).

OUTPUT JSON SCHEMA (exact structure, valid JSON):
{
  "ai_findings": [
    {
      "id": "ai-001",
      "title": "Potential Whitelist Re-whitelisting Attack",
      "severity": "HIGH|MEDIUM|LOW",
      "tool_correlation": ["slither-reentrancy", "mythril-overflow"],
      "impact": "Tokens added maliciously during liquidation",
      "likelihood": "MEDIUM",
      "recommendation": "Audit whitelistLength monotonicity invariant",
      "evidence": ["line 123 in Vault.sol"]
    }
  ],
  "suggested_invariants": [
    "// Foundry invariant example\\ninvariant_whitelistMonotonic() public { ... }"
  ],
  "review_hotspots": [
    "Vault.sol:whitelistTokens(200-250)",
    "PoolAmounts math: check overflow patterns"
  ],
  "overall_risk": {
    "level": "HIGH",
    "confidence": 8,
    "narrative": "High due to oracle staleness + concentration in LP tokens."
  },
  "version": "1.0"
}

Be concise, evidence-based, DeFi-specific. Never invent code/findings.`;

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function safeParseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const trimmed = String(text || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (_err) {
        return null;
      }
    }
    return null;
  }
}

function validateAiSchema(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!Array.isArray(obj.ai_findings)) return false;
  if (!Array.isArray(obj.suggested_invariants)) return false;
  if (!Array.isArray(obj.review_hotspots)) return false;
  if (!obj.overall_risk || typeof obj.overall_risk !== "object") return false;

  const allowed = new Set(["HIGH", "MEDIUM", "LOW"]);
  for (const finding of obj.ai_findings) {
    if (!finding || typeof finding !== "object") return false;
    const sev = String(finding.severity || "").toUpperCase();
    if (!allowed.has(sev)) return false;
  }
  return true;
}

function normalizeAiSchema(obj) {
  const normalized = { ...obj };
  normalized.ai_findings = (normalized.ai_findings || []).map((f, idx) => ({
    id: f.id || `ai-${String(idx + 1).padStart(3, "0")}`,
    title: f.title || "AI finding",
    severity: String(f.severity || "LOW").toUpperCase(),
    tool_correlation: Array.isArray(f.tool_correlation) ? f.tool_correlation : [],
    impact: f.impact || "N/A",
    likelihood: f.likelihood || "N/A",
    recommendation: f.recommendation || "N/A",
    evidence: Array.isArray(f.evidence) ? f.evidence : []
  }));
  normalized.suggested_invariants = Array.isArray(normalized.suggested_invariants)
    ? normalized.suggested_invariants
    : [];
  normalized.review_hotspots = Array.isArray(normalized.review_hotspots)
    ? normalized.review_hotspots
    : [];
  normalized.overall_risk = normalized.overall_risk && typeof normalized.overall_risk === "object"
    ? normalized.overall_risk
    : { level: "UNKNOWN", confidence: 0, narrative: "No narrative provided." };
  normalized.version = normalized.version || "1.0";
  normalized.meta = normalized.meta && typeof normalized.meta === "object" ? normalized.meta : {};
  return normalized;
}

async function preflightAiEndpoint(aiUrl) {
  const response = await fetch(`${aiUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`ai health check failed: ${response.status}`);
  }
}

function loadSourceExcerpts(bundlePath, existingExcerpts) {
  if (Array.isArray(existingExcerpts) && existingExcerpts.length > 0) {
    return existingExcerpts;
  }

  const sourceDir = path.join(bundlePath, "security", "source");
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  const excerpts = [];
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".sol")) continue;
    const filePath = path.join(sourceDir, entry.name);
    const content = fs.readFileSync(filePath, "utf8");
    excerpts.push({
      file: entry.name,
      excerpt: content.slice(0, 2000)
    });
    if (excerpts.length >= 3) break;
  }
  return excerpts;
}

async function runAIAgent({ bundlePath, aiUrl, aiModel, context }) {
  const securityDir = path.join(bundlePath, "security");
  fs.mkdirSync(securityDir, { recursive: true });

  const manifest = context && context.manifest
    ? context.manifest
    : readJsonIfExists(path.join(bundlePath, "manifest.json"), {});

  const audit = context && context.audit
    ? context.audit
    : readJsonIfExists(path.join(bundlePath, "audit.json"), { tokens: [] });

  const normalizedFindings = context && context.findings
    ? context.findings
    : readJsonIfExists(path.join(securityDir, "findings.normalized.json"), { findings: [] });

  const bytecodeHash = context && context.bytecodeHash
    ? context.bytecodeHash
    : "N/A";

  const sourceExcerpts = loadSourceExcerpts(
    bundlePath,
    context && Array.isArray(context.sourceExcerpts) ? context.sourceExcerpts : []
  );

  const cacheInput = {
    manifest,
    audit,
    normalizedFindings,
    bytecodeHash,
    sourceExcerpts,
    model: aiModel
  };
  const inputHash = crypto.createHash("sha256").update(JSON.stringify(cacheInput)).digest("hex");
  const cachePath = path.join(securityDir, `.ai-cache-${inputHash.slice(0, 16)}.json`);

  const prompt = PROMPT_TEMPLATE
    .replace("{MANIFEST_SUMMARY}", JSON.stringify(manifest))
    .replace("{AUDIT_SUMMARY}", JSON.stringify(audit))
    .replace("{NORMALIZED_FINDINGS}", JSON.stringify(normalizedFindings))
    .replace("{BYTECODE_HASH}", JSON.stringify(bytecodeHash))
    .replace("{SOURCE_EXCERPTS}", JSON.stringify(sourceExcerpts));

  const outputJsonPath = path.join(securityDir, "ai_findings.normalized.json");
  const invariantsPath = path.join(securityDir, "ai_suggested_invariants.md");
  const summaryPath = path.join(securityDir, "ai_summary.md");

  if (fs.existsSync(cachePath)) {
    const cached = readJsonIfExists(cachePath, null);
    if (cached && validateAiSchema(cached)) {
      const parsed = normalizeAiSchema(cached);
      parsed.meta.schema_valid = true;
      parsed.meta.cache_hit = true;
      parsed.meta.model = aiModel;
      parsed.meta.prompt_version = PROMPT_VERSION;
      parsed.meta.input_hash = inputHash;
      fs.writeFileSync(outputJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      fs.writeFileSync(
        invariantsPath,
        `${(parsed.suggested_invariants || []).join("\n\n")}\n`,
        "utf8"
      );
      fs.writeFileSync(
        summaryPath,
        `# AI Triage Summary\n\n${parsed.overall_risk && parsed.overall_risk.narrative ? parsed.overall_risk.narrative : "No narrative provided."}\n`,
        "utf8"
      );

      return {
        status: "cached",
        model: aiModel,
        schema_valid: true,
        cache_hit: true,
        ai_findings: parsed.ai_findings,
        outputFiles: [outputJsonPath, invariantsPath, summaryPath]
      };
    }
  }

  try {
    if (typeof fetch !== "function") {
      throw new Error("global fetch unavailable; upgrade Node.js runtime");
    }

    await preflightAiEndpoint(aiUrl);

    const response = await fetch(`${aiUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel,
        prompt,
        format: "json",
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ai endpoint failed: ${response.status}`);
    }

    const payload = await response.json();
    const parsedRaw = safeParseModelJson(payload.response);
    if (!parsedRaw || !validateAiSchema(parsedRaw)) {
      throw new Error("invalid AI output schema");
    }
    const parsed = normalizeAiSchema(parsedRaw);
    parsed.meta.schema_valid = true;
    parsed.meta.cache_hit = false;
    parsed.meta.model = aiModel;
    parsed.meta.prompt_version = PROMPT_VERSION;
    parsed.meta.input_hash = inputHash;

    fs.writeFileSync(outputJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      invariantsPath,
      `${(parsed.suggested_invariants || []).join("\n\n")}\n`,
      "utf8"
    );
    fs.writeFileSync(
      summaryPath,
      `# AI Triage Summary\n\n${parsed.overall_risk && parsed.overall_risk.narrative ? parsed.overall_risk.narrative : "No narrative provided."}\n`,
      "utf8"
    );

    fs.writeFileSync(cachePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    return {
      status: "ok",
      model: aiModel,
      schema_valid: true,
      cache_hit: false,
      ai_findings: parsed.ai_findings,
      outputFiles: [outputJsonPath, invariantsPath, summaryPath]
    };
  } catch (error) {
    const fallback = {
      ai_findings: [],
      suggested_invariants: [],
      review_hotspots: [],
      overall_risk: {
        level: "UNKNOWN",
        confidence: 0,
        narrative: `AI triage failed: ${error.message}`
      },
      version: "1.0",
      meta: {
        schema_valid: false,
        cache_hit: false,
        model: aiModel,
        prompt_version: PROMPT_VERSION,
        input_hash: inputHash,
        error: error.message
      }
    };

    fs.writeFileSync(outputJsonPath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    fs.writeFileSync(invariantsPath, "# AI Invariants\n\nAI triage unavailable.\n", "utf8");
    fs.writeFileSync(summaryPath, `# AI Triage Summary\n\n${fallback.overall_risk.narrative}\n`, "utf8");

    return {
      status: "error",
      model: aiModel,
      schema_valid: false,
      cache_hit: false,
      ai_findings: [],
      outputFiles: [outputJsonPath, invariantsPath, summaryPath]
    };
  }
}

module.exports = {
  runAIAgent
};
