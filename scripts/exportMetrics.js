#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escCsv(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escPromLabel(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function severityToScore(severity) {
  const s = String(severity || "").toUpperCase();
  if (s === "CRITICAL") return 4;
  if (s === "HIGH") return 3;
  if (s === "MEDIUM") return 2;
  if (s === "LOW") return 1;
  return 0;
}

function resolveManifestPaths(explicitPattern) {
  if (explicitPattern) {
    return listManifestPathsByPattern(explicitPattern);
  }

  const latestPath = path.resolve(process.cwd(), "outputs", "bundles", "LATEST.json");
  if (fs.existsSync(latestPath)) {
    try {
      const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
      if (latest && latest.absolutePath) {
        const manifestPath = path.join(String(latest.absolutePath), "engagement.manifest.json");
        if (fs.existsSync(manifestPath)) {
          return [manifestPath];
        }
      }
    } catch (_) {
      // fall through to full scan
    }
  }

  return listManifestPathsByPattern("outputs/bundles/*/engagement.manifest.json");
}

function listManifestPathsByPattern(pattern) {
  if (!pattern.includes("*")) {
    const asPath = path.resolve(process.cwd(), pattern);
    return fs.existsSync(asPath) ? [asPath] : [];
  }

  const bundlesRoot = path.resolve(process.cwd(), "outputs", "bundles");
  if (!fs.existsSync(bundlesRoot)) {
    return [];
  }

  const paths = [];
  const entries = fs.readdirSync(bundlesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(bundlesRoot, entry.name, "engagement.manifest.json");
    if (fs.existsSync(manifestPath)) {
      paths.push(manifestPath);
    }
  }
  return paths;
}

function readMetricsRecord(manifestPath) {
  const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const metrics = payload.metrics || {};
  const batchName = path.basename(path.dirname(manifestPath));
  const targetsTotal = Number(metrics.targets_total || 0);
  const targetsPassed = Number(metrics.targets_passed || 0);
  const flaked = Number(metrics.targets_flaked || 0);
  const transientRetries = Math.max(0, flaked);

  return {
    timestamp: payload.generatedAt || new Date().toISOString(),
    batchRoot: batchName,
    clientId: payload.clientId || payload.client || "unknown",
    engagementId: payload.engagementId || payload.engagement || "unknown",
    toolVersion: payload.tools && payload.tools.node ? payload.tools.node : "unknown",
    chainCount: Array.isArray(payload.targets) ? payload.targets.length : 0,
    batchPassed: payload.passed ? 1 : 0,
    batch_duration_ms: Number(metrics.batch_duration_ms || 0),
    targets_total: targetsTotal,
    targets_passed: targetsPassed,
    targets_failed_total: Math.max(0, targetsTotal - targetsPassed),
    targets_flaked: flaked,
    transient_retry_total: transientRetries,
    avg_rpc_grade: Number(metrics.avg_rpc_grade || 0),
    top_risk_severity: String(metrics.top_risk_severity || "NONE"),
    archive_success: metrics.archive_success ? 1 : 0
  };
}

function writeNdjson(metricsDir, rows) {
  const outputPath = path.join(metricsDir, "metrics.ndjson");
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(outputPath, `${body}${rows.length ? "\n" : ""}`, "utf8");
  return outputPath;
}

function writeCsv(metricsDir, rows) {
  const outputPath = path.join(metricsDir, "metrics.csv");
  const header = [
    "timestamp",
    "batchRoot",
    "clientId",
    "engagementId",
    "toolVersion",
    "chainCount",
    "batchPassed",
    "batch_duration_ms",
    "targets_total",
    "targets_passed",
    "targets_failed_total",
    "targets_flaked",
    "transient_retry_total",
    "avg_rpc_grade",
    "top_risk_severity",
    "archive_success"
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      escCsv(row.timestamp),
      escCsv(row.batchRoot),
      escCsv(row.clientId),
      escCsv(row.engagementId),
      escCsv(row.toolVersion),
      row.chainCount,
      row.batchPassed,
      row.batch_duration_ms,
      row.targets_total,
      row.targets_passed,
      row.targets_failed_total,
      row.targets_flaked,
      row.transient_retry_total,
      row.avg_rpc_grade,
      escCsv(row.top_risk_severity),
      row.archive_success
    ].join(","));
  }

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  return outputPath;
}

function promLine(name, labels, value) {
  const pairs = Object.entries(labels).map(([key, v]) => `${key}="${escPromLabel(v)}"`);
  return `${name}{${pairs.join(",")}} ${value}`;
}

function writeProm(metricsDir, rows) {
  const outputPath = path.join(metricsDir, "gmx_audit_batch.prom");
  const lines = [
    "# HELP gmx_audit_batch_duration_ms Batch duration in milliseconds.",
    "# TYPE gmx_audit_batch_duration_ms gauge",
    "# HELP gmx_audit_batch_passed Batch success state (0/1).",
    "# TYPE gmx_audit_batch_passed gauge",
    "# HELP gmx_audit_targets_total Total number of targets in a batch.",
    "# TYPE gmx_audit_targets_total gauge",
    "# HELP gmx_audit_targets_passed Number of passed targets in a batch.",
    "# TYPE gmx_audit_targets_passed gauge",
    "# HELP gmx_audit_target_failed_total Number of failed targets in a batch.",
    "# TYPE gmx_audit_target_failed_total gauge",
    "# HELP gmx_audit_targets_flaked Number of targets requiring retry attempts.",
    "# TYPE gmx_audit_targets_flaked gauge",
    "# HELP gmx_audit_transient_retry_total Number of transient retries recorded in a batch.",
    "# TYPE gmx_audit_transient_retry_total gauge",
    "# HELP gmx_audit_avg_rpc_grade Average RPC grade score for a batch.",
    "# TYPE gmx_audit_avg_rpc_grade gauge",
    "# HELP gmx_audit_top_risk_severity Top risk severity score (NONE=0,LOW=1,MEDIUM=2,HIGH=3,CRITICAL=4).",
    "# TYPE gmx_audit_top_risk_severity gauge",
    "# HELP gmx_audit_archive_success Whether archive upload succeeded (0/1).",
    "# TYPE gmx_audit_archive_success gauge"
  ];

  for (const row of rows) {
    const labels = {
      client: row.clientId,
      engagement: row.engagementId,
      chain_count: row.chainCount,
      tool_version: row.toolVersion,
      batch_root: row.batchRoot
    };

    lines.push(promLine("gmx_audit_batch_duration_ms", labels, row.batch_duration_ms));
    lines.push(promLine("gmx_audit_batch_passed", labels, row.batchPassed));
    lines.push(promLine("gmx_audit_targets_total", labels, row.targets_total));
    lines.push(promLine("gmx_audit_targets_passed", labels, row.targets_passed));
    lines.push(promLine("gmx_audit_target_failed_total", labels, row.targets_failed_total));
    lines.push(promLine("gmx_audit_targets_flaked", labels, row.targets_flaked));
    lines.push(promLine("gmx_audit_transient_retry_total", labels, row.transient_retry_total));
    lines.push(promLine("gmx_audit_avg_rpc_grade", labels, row.avg_rpc_grade));
    lines.push(promLine("gmx_audit_top_risk_severity", labels, severityToScore(row.top_risk_severity)));
    lines.push(promLine("gmx_audit_archive_success", labels, row.archive_success));
  }

  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  return outputPath;
}

function writeGrafanaTemplate(rootDir) {
  const outputPath = path.join(rootDir, "grafana-dashboard.json");
  const dashboard = {
    title: "GMX Audit Batches",
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    tags: ["gmx", "audit", "batch"],
    templating: {
      list: [
        {
          name: "client",
          type: "query",
          datasource: "Prometheus",
          query: "label_values(gmx_audit_batch_duration_ms, client)",
          refresh: 1
        },
        {
          name: "engagement",
          type: "query",
          datasource: "Prometheus",
          query: "label_values(gmx_audit_batch_duration_ms{client=~\"$client\"}, engagement)",
          refresh: 1
        }
      ]
    },
    panels: [
      {
        title: "Batch Duration (ms)",
        type: "stat",
        gridPos: { h: 5, w: 8, x: 0, y: 0 },
        targets: [
          { expr: "avg(gmx_audit_batch_duration_ms{client=~\"$client\",engagement=~\"$engagement\"})" }
        ]
      },
      {
        title: "Pass Rate %",
        type: "gauge",
        gridPos: { h: 5, w: 8, x: 8, y: 0 },
        targets: [
          { expr: "100 * sum(gmx_audit_targets_passed{client=~\"$client\",engagement=~\"$engagement\"}) / clamp_min(sum(gmx_audit_targets_total{client=~\"$client\",engagement=~\"$engagement\"}), 1)" }
        ]
      },
      {
        title: "Archive Success %",
        type: "gauge",
        gridPos: { h: 5, w: 8, x: 16, y: 0 },
        targets: [
          { expr: "100 * avg(gmx_audit_archive_success{client=~\"$client\",engagement=~\"$engagement\"})" }
        ]
      },
      {
        title: "Flake Count",
        type: "timeseries",
        gridPos: { h: 8, w: 12, x: 0, y: 5 },
        targets: [
          { expr: "sum(gmx_audit_targets_flaked{client=~\"$client\",engagement=~\"$engagement\"}) by (batch_root)" }
        ]
      },
      {
        title: "Failed Targets",
        type: "timeseries",
        gridPos: { h: 8, w: 12, x: 12, y: 5 },
        targets: [
          { expr: "sum(gmx_audit_target_failed_total{client=~\"$client\",engagement=~\"$engagement\"}) by (batch_root)" }
        ]
      }
    ],
    annotations: {
      list: [
        {
          name: "Flakes",
          type: "dashboard",
          enable: true,
          expr: "sum(gmx_audit_targets_flaked{client=~\"$client\",engagement=~\"$engagement\"}) > 0"
        }
      ]
    }
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  return outputPath;
}

function main() {
  const explicitPattern = process.argv[2] || null;
  const manifestPaths = resolveManifestPaths(explicitPattern);
  if (manifestPaths.length === 0) {
    console.error("No engagement manifests found for export.");
    process.exit(1);
  }

  const rows = manifestPaths.map(readMetricsRecord).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const metricsDir = path.resolve(process.cwd(), "outputs", "metrics");
  ensureDir(metricsDir);

  const ndjsonPath = writeNdjson(metricsDir, rows);
  const csvPath = writeCsv(metricsDir, rows);
  const promPath = writeProm(metricsDir, rows);
  const dashboardPath = writeGrafanaTemplate(process.cwd());

  console.log(`metrics manifests: ${rows.length}`);
  console.log(`ndjson: ${ndjsonPath}`);
  console.log(`csv: ${csvPath}`);
  console.log(`prometheus: ${promPath}`);
  console.log(`dashboard: ${dashboardPath}`);
}

main();
