import crypto from "crypto";
import fs from "fs";
import path from "path";

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import Database from "better-sqlite3";
import { globSync } from "glob";

import {
  classifyPending,
  type RunData,
  scoreBadgeColor,
  scoreLabel
} from "./utils/securityScore";

type RawLog = {
  filePath: string;
  chain: string;
  content: string;
};

type InsertRunData = RunData & {
  run_uid: string;
};

type TriageProof = {
  detector?: string;
  severity?: string;
  chain?: string;
  block?: number;
  usd_impact?: string;
  title?: string;
  status?: string;
};

type TriageResult = {
  schema_version: number;
  scanned_at?: string;
  total_proofs?: number;
  critical_count?: number;
  high_count?: number;
  medium_count?: number;
  proofs?: TriageProof[];
};

type ProofSummary = {
  schema_version: number;
  severity?: string;
  detector?: string;
  chain?: string;
  block?: number;
  userNet?: string;
  poolNet?: string;
};

type FindingRow = {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  chain: string;
  block: number;
  impact: string;
  impactNumeric: number;
  status: string;
};

const SCORE_WEIGHTS: Record<FindingRow["severity"], number> = {
  critical: -25,
  high: -15,
  medium: -5,
  low: -1
};

function getArg(flag: string, defaultValue: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || !process.argv[idx + 1]) return defaultValue;
  return process.argv[idx + 1];
}

function readTextFileAuto(filePath: string): string {
  const raw = fs.readFileSync(filePath);
  if (raw.length >= 2) {
    const b0 = raw[0];
    const b1 = raw[1];

    if (b0 === 0xff && b1 === 0xfe) {
      return raw.slice(2).toString("utf16le");
    }
    if (b0 === 0xfe && b1 === 0xff) {
      return raw.slice(2).swap16().toString("utf16le");
    }
  }

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return raw.slice(3).toString("utf8");
  }

  return raw.toString("utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function collectLogs(): RawLog[] {
  const logs: RawLog[] = [];

  const rootLog = path.join(process.cwd(), "rotation.log");
  if (fs.existsSync(rootLog)) {
    logs.push({
      filePath: rootLog,
      chain: "unknown",
      content: readTextFileAuto(rootLog)
    });
  }

  const rotationDir = path.join(process.cwd(), "exploit-proofs", "rotation-logs");
  if (fs.existsSync(rotationDir)) {
    for (const entry of fs.readdirSync(rotationDir)) {
      if (!entry.endsWith(".log")) continue;
      const filePath = path.join(rotationDir, entry);
      const chain = entry.match(/arbitrum|avalanche|polygon|optimism/i)?.[0]?.toLowerCase() ?? "unknown";
      logs.push({ filePath, chain, content: readTextFileAuto(filePath) });
    }
  }

  return logs;
}

function countProofs(chain: string, block: number): number {
  const proofDir = path.join(process.cwd(), "exploit-proofs");
  if (!fs.existsSync(proofDir)) return 0;

  return fs
    .readdirSync(proofDir)
    .filter((f) => f.endsWith(".json") && !f.includes("gitkeep"))
    .filter((f) => {
      const fullPath = path.join(proofDir, f);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8")) as { chain?: string; block?: number };
        const chainOk = chain === "unknown" || parsed.chain === chain;
        const blockOk = block === 0 || parsed.block === block;
        return chainOk && blockOk;
      } catch {
        return false;
      }
    }).length;
}

function buildRunUid(input: Omit<InsertRunData, "run_uid">): string {
  const key = [
    input.timestamp,
    input.chain,
    input.block,
    input.passing,
    input.pending,
    input.failing,
    input.proof_count,
    input.duration_ms,
    input.unexplained_pending,
    input.security_score,
    input.log_path || ""
  ].join("|");
  return crypto.createHash("sha1").update(key).digest("hex");
}

function parseRunWindow(lines: string[], filePath: string, chainHint: string, forcedBlock = 0): InsertRunData | null {
  const joined = lines.join("\n");
  const passing = Number((joined.match(/(\d+)\s+passing/i) || [])[1] || "0");
  if (passing <= 0) return null;

  const pending = Number((joined.match(/(\d+)\s+pending/i) || [])[1] || "0");
  const failing = Number((joined.match(/(\d+)\s+failing/i) || [])[1] || "0");
  const blockFromContent = Number(
    (joined.match(/(?:FORK_BLOCK|ARBITRUM_FORK_BLOCK|AVALANCHE_FORK_BLOCK)[=: ]+(\d+)/i) || [])[1] || "0"
  );
  const block = forcedBlock || blockFromContent;

  const chainByContent =
    (joined.match(/(?:GMX_CHAIN|chain)[=: ]+(arbitrum|avalanche|polygon|optimism)/i) || [])[1]?.toLowerCase() || "unknown";
  const chain = chainHint !== "unknown" ? chainHint : chainByContent;

  const tsText = (joined.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/) || [])[1];
  const ts = tsText ? new Date(`${tsText}Z`).getTime() : fs.statSync(filePath).mtimeMs;

  const durationFromMs = Number((joined.match(/\((\d+)ms\)/i) || [])[1] || "0");
  const durationFromMin = Number((joined.match(/\((\d+)m\)/i) || [])[1] || "0") * 60_000;
  const durationFromKey = Number((joined.match(/duration[_ ]ms[=: ]+(\d+)/i) || [])[1] || "0");
  const durationMs = durationFromMs || durationFromMin || durationFromKey;

  let unexplainedPending = 0;
  for (const line of lines) {
    if (!/pending|\- /.test(line)) continue;
    if (classifyPending(line, line) === "unknown") unexplainedPending += 1;
  }

  const proofCount = countProofs(chain, block);
  let score = 100;
  score -= failing * 30;
  score -= proofCount * 50;
  score -= unexplainedPending * 5;
  const securityScore = Math.max(0, score);

  const row: Omit<InsertRunData, "run_uid"> = {
    timestamp: ts,
    chain,
    block,
    passing,
    pending,
    failing,
    proof_count: proofCount,
    duration_ms: durationMs,
    unexplained_pending: unexplainedPending,
    security_score: securityScore,
    log_path: filePath
  };

  return {
    ...row,
    run_uid: buildRunUid(row)
  };
}

function parseRunsFromLog(log: RawLog): InsertRunData[] {
  const normalized = log.content.replace(/\u001b\[[0-9;]*m/g, "");
  const sectionRe = /===\s*Testing block\s*(\d+)\s*===([\s\S]*?)(?===\s*Testing block\s*\d+\s*===|$)/gi;
  const runs: InsertRunData[] = [];

  for (const match of normalized.matchAll(sectionRe)) {
    const block = Number(match[1] || "0");
    const sectionLines = (match[2] || "").split(/\r?\n/);
    const run = parseRunWindow(sectionLines, log.filePath, log.chain, block);
    if (run) runs.push(run);
  }

  if (runs.length > 0) return runs;

  const lines = normalized.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/(\d+)\s+passing/i.test(lines[i])) continue;
    const window = lines.slice(Math.max(0, i - 20), Math.min(lines.length, i + 25));
    const run = parseRunWindow(window, log.filePath, log.chain);
    if (run) runs.push(run);
  }

  return runs;
}

function ensureDB(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      run_uid             TEXT,
      timestamp           REAL    NOT NULL,
      chain               TEXT    NOT NULL,
      block               INTEGER NOT NULL,
      passing             INTEGER NOT NULL DEFAULT 0,
      pending             INTEGER NOT NULL DEFAULT 0,
      failing             INTEGER NOT NULL DEFAULT 0,
      proof_count         INTEGER NOT NULL DEFAULT 0,
      duration_ms         INTEGER NOT NULL DEFAULT 0,
      unexplained_pending INTEGER NOT NULL DEFAULT 0,
      security_score      INTEGER NOT NULL DEFAULT 100,
      log_path            TEXT,
      notes               TEXT
    );
  `);

  const columns = db
    .prepare("PRAGMA table_info(runs)")
    .all() as Array<{ name: string; type: string }>;
  const columnSet = new Set(columns.map((column) => column.name));

  if (!columnSet.has("run_uid")) {
    db.exec("ALTER TABLE runs ADD COLUMN run_uid TEXT");
  }
  if (!columnSet.has("unexplained_pending")) {
    db.exec("ALTER TABLE runs ADD COLUMN unexplained_pending INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnSet.has("security_score")) {
    db.exec("ALTER TABLE runs ADD COLUMN security_score INTEGER NOT NULL DEFAULT 100");
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_uid ON runs(run_uid);
    CREATE INDEX IF NOT EXISTS idx_runs_chain ON runs(chain);
    CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(timestamp);
  `);

  return db;
}

function insertRuns(db: Database.Database, runs: InsertRunData[]): number {
  if (!runs.length) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO runs (
      run_uid, timestamp, chain, block, passing, pending, failing,
      proof_count, duration_ms, unexplained_pending, security_score, log_path, notes
    ) VALUES (
      @run_uid, @timestamp, @chain, @block, @passing, @pending, @failing,
      @proof_count, @duration_ms, @unexplained_pending, @security_score, @log_path, @notes
    )
  `);

  let inserted = 0;
  const tx = db.transaction((rows: InsertRunData[]) => {
    for (const row of rows) {
      const result = insert.run({
        ...row,
        log_path: row.log_path ?? null,
        notes: row.notes ?? null
      });
      if (result.changes > 0) inserted += 1;
    }
  });

  tx(runs);
  return inserted;
}

function queryRuns(db: Database.Database, limit = 50): RunData[] {
  return db
    .prepare(
      `
      SELECT timestamp, chain, block, passing, pending, failing,
             proof_count, duration_ms, unexplained_pending, security_score, log_path, notes
      FROM runs
      ORDER BY timestamp DESC
      LIMIT ?
    `
    )
    .all(limit) as RunData[];
}

function queryRunCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as total FROM runs").get() as { total: number };
  return Number(row?.total || 0);
}

function compileValidator(schemaPath: string, ajv: Ajv): ValidateFunction {
  const schema = readJson<object>(schemaPath);
  return ajv.compile(schema);
}

function assertValid(label: string, filePath: string, validate: ValidateFunction, payload: unknown): void {
  const valid = validate(payload);
  if (valid) return;

  const details = (validate.errors || [])
    .map((err: ErrorObject) => `${err.instancePath || "/"} ${err.message || "invalid"}`)
    .join("; ");
  throw new Error(`Schema validation failed for ${label} at ${filePath}: ${details}`);
}

function loadValidatedInputs(triagePath: string, proofPattern: string): { triage: TriageResult | null; proofs: ProofSummary[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const triageSchemaPath = path.resolve(process.cwd(), "schemas", "triage-result.schema.v1.json");
  const proofSchemaPath = path.resolve(process.cwd(), "schemas", "proof-package.schema.v1.json");

  const triageValidate = compileValidator(triageSchemaPath, ajv);
  const proofValidate = compileValidator(proofSchemaPath, ajv);

  let triage: TriageResult | null = null;
  const triageFullPath = path.resolve(process.cwd(), triagePath);
  if (fs.existsSync(triageFullPath)) {
    triage = readJson<TriageResult>(triageFullPath);
    assertValid("triage-result", triageFullPath, triageValidate, triage);
  }

  const proofFiles = globSync(proofPattern, {
    cwd: process.cwd(),
    windowsPathsNoEscape: true,
    nodir: true
  });

  const proofs: ProofSummary[] = [];
  for (const relativePath of proofFiles) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    const payload = readJson<ProofSummary>(fullPath);
    assertValid("proof-package-summary", fullPath, proofValidate, payload);
    proofs.push(payload);
  }

  return { triage, proofs };
}

function normalizeSeverity(input: string | undefined): FindingRow["severity"] {
  const sev = (input || "").toLowerCase().trim();
  if (sev.startsWith("crit")) return "critical";
  if (sev.startsWith("high")) return "high";
  if (sev.startsWith("med")) return "medium";
  if (sev.startsWith("low")) return "low";
  return "low";
}

function severityLabel(sev: FindingRow["severity"]): string {
  if (sev === "critical") return "CRITICAL";
  if (sev === "high") return "HIGH";
  if (sev === "medium") return "MEDIUM";
  return "LOW";
}

function toImpactNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatImpact(value: string | undefined): string {
  if (!value) return "--";
  if (/^\$/.test(value.trim())) return value.trim();
  return `$${value.trim()}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toIsoUtc(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function triageToFindings(triage: TriageResult | null): FindingRow[] {
  if (!triage || !Array.isArray(triage.proofs)) return [];

  const rows = triage.proofs.map((proof) => {
    const severity = normalizeSeverity(proof.severity);
    const chain = (proof.chain || "unknown").toLowerCase();
    const title = proof.title || `${proof.detector || "detector"} finding`;
    const impact = formatImpact(proof.usd_impact);
    const impactNumeric = toImpactNumber(proof.usd_impact);
    const status = (proof.status || "new").toLowerCase();

    return {
      severity,
      chain,
      title,
      impact,
      impactNumeric,
      status,
      block: Number(proof.block || 0)
    } as FindingRow;
  });

  const rank: Record<FindingRow["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  };

  rows.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    if (a.impactNumeric !== b.impactNumeric) return b.impactNumeric - a.impactNumeric;
    return b.block - a.block;
  });

  return rows;
}

function computeOverviewScore(findings: FindingRow[]): number {
  let score = 100;
  for (const finding of findings) {
    score += SCORE_WEIGHTS[finding.severity] || 0;
  }
  return Math.max(0, Math.min(100, score));
}

function buildSeverityCounts(findings: FindingRow[]): Record<FindingRow["severity"], number> {
  const counts: Record<FindingRow["severity"], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function buildTrendSvg(runs: RunData[]): string {
  const points = runs.slice(0, 30).reverse();
  if (points.length === 0) {
    return `<text x="12" y="48" fill="#64748b" font-size="12">No historical runs yet</text>`;
  }

  const width = 620;
  const height = 160;
  const pad = 16;
  const step = (width - pad * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((run, index) => {
    const x = pad + step * index;
    const y = pad + (1 - run.security_score / 100) * (height - pad * 2);
    return { x, y, run };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const circles = coords
    .map((c) => {
      const fill = c.run.security_score >= 90 ? "#16a34a" : c.run.security_score >= 70 ? "#f59e0b" : "#dc2626";
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="${fill}" />`;
    })
    .join("\n");

  return [
    `<line x1="${pad}" y1="${pad}" x2="${width - pad}" y2="${pad}" stroke="#334155" stroke-width="1" />`,
    `<line x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}" stroke="#334155" stroke-width="1" stroke-dasharray="4" />`,
    `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#334155" stroke-width="1" />`,
    `<polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2" />`,
    circles
  ].join("\n");
}

function buildSeverityBars(counts: Record<FindingRow["severity"], number>): string {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  const rows: Array<{ key: FindingRow["severity"]; label: string; color: string }> = [
    { key: "critical", label: "Critical", color: "#dc2626" },
    { key: "high", label: "High", color: "#f97316" },
    { key: "medium", label: "Medium", color: "#f59e0b" },
    { key: "low", label: "Low", color: "#65a30d" }
  ];

  return rows
    .map((row) => {
      const count = counts[row.key];
      const percent = total > 0 ? (count / total) * 100 : 0;
      return `
      <div class="severity-row">
        <div class="severity-name">${row.label}</div>
        <div class="severity-bar-wrap"><div class="severity-bar" style="width:${percent.toFixed(2)}%;background:${row.color}"></div></div>
        <div class="severity-count">${count}</div>
      </div>`;
    })
    .join("\n");
}

function buildFindingsRows(findings: FindingRow[]): string {
  if (findings.length === 0) {
    return `<tr><td colspan="6" class="empty">No findings in current triage artifact.</td></tr>`;
  }

  return findings
    .slice(0, 12)
    .map((finding) => {
      const sev = severityLabel(finding.severity);
      const sevClass = `sev-${finding.severity}`;
      const block = finding.block > 0 ? finding.block.toLocaleString("en-US") : "--";
      return `
      <tr>
        <td><span class="severity ${sevClass}">${sev}</span></td>
        <td>${escapeHtml(finding.title)}</td>
        <td>${escapeHtml(finding.chain)}</td>
        <td class="mono">${block}</td>
        <td class="mono">${escapeHtml(finding.impact)}</td>
        <td><span class="status">${escapeHtml(finding.status)}</span></td>
      </tr>`;
    })
    .join("\n");
}

function chooseGeneratedAt(triage: TriageResult | null, runs: RunData[]): string {
  if (triage?.scanned_at) return triage.scanned_at;
  if (runs.length > 0) return toIsoUtc(runs[0].timestamp);
  return "N/A";
}

function chooseChainLabel(triage: TriageResult | null, runs: RunData[]): string {
  const chains = new Set<string>();

  if (triage?.proofs) {
    for (const proof of triage.proofs) {
      if (proof.chain) chains.add(proof.chain.toLowerCase());
    }
  }

  for (const run of runs) {
    chains.add(run.chain.toLowerCase());
  }

  const values = [...chains].filter(Boolean);
  if (values.length === 0) return "unknown";
  if (values.length === 1) return values[0];
  return `${values.length} chains`;
}

function generateHtml(input: {
  runs: RunData[];
  totalRuns: number;
  findings: FindingRow[];
  proofCount: number;
  generatedAt: string;
  chainLabel: string;
}): string {
  const score = computeOverviewScore(input.findings);
  const scoreColor = scoreBadgeColor(score);
  const scoreState = scoreLabel(score);
  const severityCounts = buildSeverityCounts(input.findings);
  const criticalHigh = severityCounts.critical + severityCounts.high;
  const trendSvg = buildTrendSvg(input.runs);
  const severityBars = buildSeverityBars(severityCounts);
  const findingsRows = buildFindingsRows(input.findings);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GMX Audit Control Center Overview</title>
  <style>
    :root {
      --bg: #0b1220;
      --surface: #101b33;
      --surface-2: #0f172a;
      --border: #2c3d63;
      --text: #dbe7ff;
      --muted: #8ea2c9;
      --critical: #dc2626;
      --high: #f97316;
      --medium: #f59e0b;
      --low: #65a30d;
      --card-radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 10% -10%, rgba(59,130,246,0.16), transparent 36%),
        radial-gradient(circle at 90% 0%, rgba(249,115,22,0.12), transparent 32%),
        var(--bg);
      color: var(--text);
      font: 14px/1.45 "Segoe UI", Tahoma, sans-serif;
    }
    .shell {
      max-width: 1260px;
      margin: 0 auto;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
    }
    .title {
      margin: 0;
      font-size: 29px;
      letter-spacing: 0.2px;
    }
    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 10px;
      color: var(--muted);
      background: rgba(15,23,42,0.8);
      font-size: 12px;
      white-space: nowrap;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card {
      background: linear-gradient(180deg, rgba(26,39,68,0.98), rgba(15,23,42,0.98));
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 14px;
      min-height: 108px;
    }
    .card h2 {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .card .value {
      margin-top: 10px;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 0.4px;
    }
    .card .hint {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .panels {
      display: grid;
      grid-template-columns: 1.7fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 12px;
    }
    .panel h3 {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--muted);
    }
    .trend {
      width: 100%;
      height: 164px;
      border-radius: 8px;
      background: var(--surface-2);
      border: 1px solid rgba(44, 61, 99, 0.7);
    }
    .severity-list { display: grid; gap: 8px; }
    .severity-row {
      display: grid;
      grid-template-columns: 72px 1fr 42px;
      align-items: center;
      gap: 8px;
    }
    .severity-name { color: var(--muted); font-size: 12px; }
    .severity-bar-wrap {
      height: 11px;
      border-radius: 999px;
      overflow: hidden;
      background: #1c2a4a;
      border: 1px solid #2b3b62;
    }
    .severity-bar { height: 100%; }
    .severity-count {
      text-align: right;
      font: 600 12px/1.2 Consolas, monospace;
      color: var(--text);
    }
    .formula {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      border-top: 1px dashed #30456f;
      padding-top: 9px;
    }
    .findings {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      overflow: hidden;
      margin-bottom: 12px;
    }
    .findings h3 {
      margin: 0;
      padding: 12px;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.09em;
      font-size: 13px;
      background: #0f1a32;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid #243658;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      background: #0f1a32;
      color: #9db0d7;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
    }
    tbody tr:hover td { background: #16264a; }
    .severity {
      display: inline-block;
      min-width: 70px;
      text-align: center;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
    }
    .sev-critical { color: #fecaca; background: rgba(220,38,38,0.25); border-color: rgba(220,38,38,0.5); }
    .sev-high { color: #fed7aa; background: rgba(249,115,22,0.2); border-color: rgba(249,115,22,0.45); }
    .sev-medium { color: #fde68a; background: rgba(245,158,11,0.2); border-color: rgba(245,158,11,0.45); }
    .sev-low { color: #d9f99d; background: rgba(132,204,22,0.2); border-color: rgba(132,204,22,0.45); }
    .status {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #395483;
      background: #12244a;
      color: #c8d8ff;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 8px;
    }
    .mono { font-family: Consolas, monospace; }
    .empty {
      text-align: center;
      color: var(--muted);
      padding: 20px;
      white-space: normal;
    }
    .footer {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #0f1a32;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 1020px) {
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panels { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .shell { padding: 14px; }
      .header { flex-direction: column; }
      .cards { grid-template-columns: 1fr; }
      th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="header">
      <div>
        <h1 class="title">GMX Audit Control Center</h1>
        <div class="subtitle">Overview dashboard generated from deterministic pipeline artifacts</div>
      </div>
      <div class="chips">
        <span class="chip">Chain: ${escapeHtml(input.chainLabel)}</span>
        <span class="chip">Generated: ${escapeHtml(input.generatedAt)}</span>
      </div>
    </section>

    <section class="cards">
      <article class="card">
        <h2>Security Score</h2>
        <div class="value" style="color:${scoreColor}">${score}/100</div>
        <div class="hint">${scoreState}</div>
      </article>
      <article class="card">
        <h2>Total Runs</h2>
        <div class="value">${input.totalRuns}</div>
        <div class="hint">Historical runs in metrics database</div>
      </article>
      <article class="card">
        <h2>Proofs Found</h2>
        <div class="value">${input.proofCount}</div>
        <div class="hint">Validated proof package summaries</div>
      </article>
      <article class="card">
        <h2>Critical / High</h2>
        <div class="value">${criticalHigh}</div>
        <div class="hint">Critical ${severityCounts.critical} + High ${severityCounts.high}</div>
      </article>
    </section>

    <section class="panels">
      <article class="panel">
        <h3>Score Over Time</h3>
        <svg class="trend" viewBox="0 0 620 160" preserveAspectRatio="none">
          ${trendSvg}
        </svg>
      </article>
      <article class="panel">
        <h3>Severity Breakdown</h3>
        <div class="severity-list">
          ${severityBars}
        </div>
        <div class="formula">
          Score formula (v1): start at 100 and deduct per finding.
          Critical -25, High -15, Medium -5, Low -1. Clamped to 0..100.
        </div>
      </article>
    </section>

    <section class="findings">
      <h3>Latest Findings</h3>
      <table>
        <thead>
          <tr>
            <th style="width:94px">Sev</th>
            <th>Title</th>
            <th style="width:90px">Chain</th>
            <th style="width:120px">Block</th>
            <th style="width:140px">Impact</th>
            <th style="width:110px">Status</th>
          </tr>
        </thead>
        <tbody>
          ${findingsRows}
        </tbody>
      </table>
    </section>

    <section class="footer">
      <span>Generated: ${escapeHtml(input.generatedAt)}</span>
      <span>Schema v1.0.0</span>
    </section>
  </main>
</body>
</html>`;
}

function main(): void {
  const dbPath = getArg("--db", "results.db");
  const outPath = getArg("--out", "dashboard.html");
  const triagePath = getArg("--triage", "outputs/triage/triage-result.json");
  const proofPattern = getArg("--proof-summaries", "proof-packages/**/summary.json");

  const logs = collectLogs();
  const parsedRuns = logs.flatMap(parseRunsFromLog);

  const db = ensureDB(path.resolve(process.cwd(), dbPath));
  const inserted = insertRuns(db, parsedRuns);
  const runs = queryRuns(db, 50);
  const totalRuns = queryRunCount(db);
  db.close();

  const { triage, proofs } = loadValidatedInputs(triagePath, proofPattern);
  const findings = triageToFindings(triage);
  const generatedAt = chooseGeneratedAt(triage, runs);
  const chainLabel = chooseChainLabel(triage, runs);

  const html = generateHtml({
    runs,
    totalRuns,
    findings,
    proofCount: proofs.length,
    generatedAt,
    chainLabel
  });

  const outFile = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf8");

  console.log(`[dashboard] logs=${logs.length} parsedRuns=${parsedRuns.length} inserted=${inserted}`);
  console.log(`[dashboard] runs=${totalRuns} findings=${findings.length} proofs=${proofs.length}`);
  console.log(`[dashboard] wrote ${outFile}`);
}

if (require.main === module) {
  main();
}
