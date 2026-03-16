import fs from "fs";
import path from "path";

import Database from "better-sqlite3";

import {
  classifyPending,
  computeSecurityScore,
  type RunData,
  scoreBadgeColor,
  scoreLabel
} from "./utils/securityScore";

type RawLog = {
  filePath: string;
  chain: string;
  content: string;
};

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

function getArg(flag: string, defaultValue: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || !process.argv[idx + 1]) return defaultValue;
  return process.argv[idx + 1];
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

function parseRunWindow(lines: string[], filePath: string, chainHint: string, forcedBlock = 0): RunData | null {
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
  const ts = tsText ? new Date(tsText).getTime() : fs.statSync(filePath).mtimeMs;

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
  const securityScore = computeSecurityScore({
    failing,
    proof_count: proofCount,
    unexplained_pending: unexplainedPending
  });

  return {
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
}

function parseRunsFromLog(log: RawLog): RunData[] {
  const normalized = log.content.replace(/\u001b\[[0-9;]*m/g, "");
  const sectionRe = /===\s*Testing block\s*(\d+)\s*===([\s\S]*?)(?===\s*Testing block\s*\d+\s*===|$)/gi;
  const runs: RunData[] = [];

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

    CREATE INDEX IF NOT EXISTS idx_runs_chain ON runs(chain);
    CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(timestamp);
  `);
  return db;
}

function insertRuns(db: Database.Database, runs: RunData[]): number {
  if (!runs.length) return 0;

  const insert = db.prepare(`
    INSERT INTO runs (
      timestamp, chain, block, passing, pending, failing,
      proof_count, duration_ms, unexplained_pending, security_score, log_path, notes
    ) VALUES (
      @timestamp, @chain, @block, @passing, @pending, @failing,
      @proof_count, @duration_ms, @unexplained_pending, @security_score, @log_path, @notes
    )
  `);

  const tx = db.transaction((rows: RunData[]) => {
    for (const row of rows) {
      insert.run({
        ...row,
        log_path: row.log_path ?? null,
        notes: row.notes ?? null
      });
    }
  });

  tx(runs);
  return runs.length;
}

function queryRuns(db: Database.Database, limit = 200): RunData[] {
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

function buildTrendSvg(runs: RunData[]): string {
  const points = runs.slice(0, 30).reverse();
  if (points.length === 0) {
    return `<text x="8" y="42" fill="#64748b" font-size="10">No run data yet</text>`;
  }

  const width = 590;
  const height = 90;
  const pad = 10;
  const step = (width - pad * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((run, index) => {
    const x = pad + step * index;
    const y = pad + (1 - run.security_score / 100) * (height - pad * 2);
    return { x, y, run };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const circles = coords
    .map((c) => {
      const fill = c.run.proof_count > 0 ? "#ef4444" : c.run.failing > 0 ? "#f59e0b" : "#22c55e";
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${fill}" />`;
    })
    .join("\n");

  return `
    <line x1="${pad}" y1="${pad}" x2="${width - pad}" y2="${pad}" stroke="#334155" stroke-width="1" />
    <line x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}" stroke="#334155" stroke-width="1" stroke-dasharray="4" />
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#334155" stroke-width="1" />
    <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2" />
    ${circles}
  `;
}

function buildStats(runs: RunData[]): {
  avg7: number;
  proofs: number;
  avgDurationSec: number;
  chains: string[];
} {
  const last7 = runs.slice(0, 7);
  const avg7 =
    last7.length > 0
      ? last7.reduce((sum, run) => sum + run.security_score, 0) / Math.max(last7.length, 1)
      : 100;

  const proofs = runs.reduce((sum, run) => sum + run.proof_count, 0);
  const avgDurationSec =
    runs.length > 0
      ? Math.round(runs.reduce((sum, run) => sum + run.duration_ms, 0) / runs.length / 1000)
      : 0;

  const chains = [...new Set(runs.map((run) => run.chain))];
  return { avg7, proofs, avgDurationSec, chains };
}

function buildRows(runs: RunData[]): string {
  if (runs.length === 0) {
    return `<tr><td colspan="8" class="empty">No runs recorded yet.</td></tr>`;
  }

  return runs
    .map((run) => {
      const rowClass = run.proof_count > 0 ? "row-danger" : run.failing > 0 ? "row-warning" : "";
      const ts = new Date(run.timestamp).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
      const scoreColor = scoreBadgeColor(run.security_score);

      return `
      <tr class="${rowClass}" data-chain="${run.chain}" data-proofs="${run.proof_count}" data-failing="${run.failing}">
        <td>${ts}</td>
        <td><span class="chain-badge">${run.chain}</span></td>
        <td class="mono">${run.block > 0 ? run.block.toLocaleString() : "-"}</td>
        <td><span class="pass">${run.passing}</span> / <span class="pend">${run.pending}</span> / <span class="fail">${run.failing}</span></td>
        <td>${run.proof_count > 0 ? `<span class="proof-badge">${run.proof_count}</span>` : "0"}</td>
        <td><span class="score-badge" style="background:${scoreColor}20;color:${scoreColor};border:1px solid ${scoreColor}">${run.security_score}</span></td>
        <td>${run.duration_ms > 0 ? `${Math.round(run.duration_ms / 1000)}s` : "-"}</td>
        <td>${run.log_path ? run.log_path.replace(/\\/g, "/") : "-"}</td>
      </tr>`;
    })
    .join("\n");
}

function generateHtml(runs: RunData[]): string {
  const { avg7, proofs, avgDurationSec, chains } = buildStats(runs);
  const scoreColor = scoreBadgeColor(avg7);
  const scoreState = scoreLabel(avg7);
  const chainOptions = ["all", ...chains].map((chain) => `<option value="${chain}">${chain}</option>`).join("\n");
  const rows = buildRows(runs);
  const trendSvg = buildTrendSvg(runs);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>gmx-audit dashboard</title>
  <style>
    :root { --bg:#0f172a; --surface:#1e293b; --border:#334155; --text:#e2e8f0; --muted:#94a3b8; --accent:#3b82f6; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: linear-gradient(180deg,#0b1220,#0f172a); color: var(--text); }
    header { padding: 20px 24px; border-bottom: 1px solid var(--border); background: rgba(15,23,42,0.85); }
    h1 { margin: 0; font-size: 22px; }
    .subtitle { color: var(--muted); margin-top: 6px; font-size: 13px; }
    main { max-width: 1200px; margin: 0 auto; padding: 18px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap: 12px; margin-bottom: 16px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
    .card strong { display: block; font-size: 26px; }
    .card span { color: var(--muted); font-size: 12px; }
    .chart { background: var(--surface); border:1px solid var(--border); border-radius:10px; padding: 12px; margin-bottom: 16px; }
    .chart svg { width: 100%; height: 90px; }
    .filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    select, input[type=text] { background: #0f172a; color: var(--text); border:1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
    label { color: var(--muted); font-size: 13px; }
    .table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom:1px solid var(--border); text-align:left; font-size: 13px; }
    th { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em; background: #111b31; }
    tr:hover td { background: #182235; }
    .row-danger td { background: rgba(239,68,68,0.08); }
    .row-warning td { background: rgba(245,158,11,0.08); }
    .chain-badge, .proof-badge, .score-badge { display:inline-block; border-radius:999px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
    .chain-badge { border:1px solid #2459a8; color:#7cb3ff; background:#1d4ed820; }
    .proof-badge { border:1px solid #ef4444; color:#ef4444; background:#ef444420; }
    .pass { color:#22c55e; } .pend { color:#f59e0b; } .fail { color:#ef4444; }
    .mono { font-family: Consolas, monospace; }
    .empty { text-align:center; color:var(--muted); padding: 24px; }
  </style>
</head>
<body>
  <header>
    <h1>gmx-audit Security Dashboard</h1>
    <div class="subtitle">Security Score ${avg7.toFixed(0)}/100 (${scoreState}) · Generated ${new Date().toLocaleString()}</div>
  </header>
  <main>
    <section class="cards">
      <article class="card" style="border-top:3px solid ${scoreColor}"><strong style="color:${scoreColor}">${avg7.toFixed(0)}/100</strong><span>7-run security score avg</span></article>
      <article class="card"><strong>${runs.length}</strong><span>Total runs in dashboard</span></article>
      <article class="card"><strong style="color:${proofs > 0 ? "#ef4444" : "#22c55e"}">${proofs}</strong><span>Proofs matched to runs</span></article>
      <article class="card"><strong>${avgDurationSec}s</strong><span>Average run duration</span></article>
    </section>
    <section class="chart">
      <svg viewBox="0 0 600 90" preserveAspectRatio="none">${trendSvg}</svg>
    </section>
    <section>
      <div class="filters">
        <select id="chainFilter">${chainOptions}</select>
        <input type="text" id="blockSearch" placeholder="Block filter" />
        <label><input type="checkbox" id="proofsOnly" /> proofs only</label>
        <label><input type="checkbox" id="failuresOnly" /> failures only</label>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Chain</th><th>Block</th><th>Pass/Pend/Fail</th><th>Proofs</th><th>Score</th><th>Duration</th><th>Log Path</th></tr>
          </thead>
          <tbody id="rows">${rows}</tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    (function() {
      const rows = Array.from(document.querySelectorAll('#rows tr'));
      const chainFilter = document.getElementById('chainFilter');
      const blockSearch = document.getElementById('blockSearch');
      const proofsOnly = document.getElementById('proofsOnly');
      const failuresOnly = document.getElementById('failuresOnly');

      function applyFilters() {
        const chain = chainFilter.value;
        const block = blockSearch.value.trim();
        const onlyProofs = proofsOnly.checked;
        const onlyFailing = failuresOnly.checked;

        rows.forEach((row) => {
          const rowChain = row.getAttribute('data-chain') || '';
          const rowProofs = Number(row.getAttribute('data-proofs') || '0');
          const rowFailing = Number(row.getAttribute('data-failing') || '0');
          const rowBlock = (row.children[2] && row.children[2].textContent) || '';

          let visible = true;
          if (chain !== 'all' && rowChain !== chain) visible = false;
          if (block && rowBlock.indexOf(block) === -1) visible = false;
          if (onlyProofs && rowProofs === 0) visible = false;
          if (onlyFailing && rowFailing === 0) visible = false;

          row.style.display = visible ? '' : 'none';
        });
      }

      chainFilter.addEventListener('change', applyFilters);
      blockSearch.addEventListener('input', applyFilters);
      proofsOnly.addEventListener('change', applyFilters);
      failuresOnly.addEventListener('change', applyFilters);
    })();
  </script>
</body>
</html>`;
}

function main(): void {
  const dbPath = getArg("--db", "results.db");
  const outPath = getArg("--out", "dashboard.html");

  console.log("[dashboard] collecting logs...");
  const logs = collectLogs();

  const parsedRuns = logs.flatMap(parseRunsFromLog);
  console.log(`[dashboard] logs=${logs.length} parsedRuns=${parsedRuns.length}`);

  const db = ensureDB(path.resolve(process.cwd(), dbPath));
  const inserted = insertRuns(db, parsedRuns);
  const runs = queryRuns(db, 200);
  db.close();

  const html = generateHtml(runs);
  const outFile = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, "utf8");

  const avg7 = runs.length > 0 ? runs.slice(0, 7).reduce((a, r) => a + r.security_score, 0) / Math.min(7, runs.length) : 100;
  console.log(`[dashboard] wrote ${outFile}`);
  console.log(`[dashboard] displayedRuns=${runs.length} inserted=${inserted} avg7=${avg7.toFixed(0)}/100`);
}

if (require.main === module) {
  main();
}