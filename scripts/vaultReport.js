const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveReportPath(outputPath, defaultExt) {
  if (outputPath === true) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    return path.resolve(process.cwd(), `outputs/reports/vault-audit-${ts}.${defaultExt}`);
  }

  return path.resolve(process.cwd(), String(outputPath));
}

function renderSecurityRows(security) {
  if (!security || !security.results) {
    return "<tr><td colspan=\"4\">Security pipeline not executed</td></tr>";
  }

  const rows = [];
  const entries = Object.entries(security.results);
  for (const [tool, result] of entries) {
    rows.push(
      `<tr><td>${escapeHtml(tool)}</td><td>${escapeHtml(result.status)}</td><td>${escapeHtml(result.reason || "-")}</td><td>${escapeHtml(result.highCount || 0)}</td></tr>`
    );
  }
  return rows.join("\n");
}

function renderTokenRows(tokens) {
  return tokens.map((t) => {
    return `<tr>
<td>${escapeHtml(t.index)}</td>
<td>${escapeHtml(t.address)}</td>
<td>${escapeHtml(t.symbol)}</td>
<td>${escapeHtml(t.decimals)}</td>
<td>${escapeHtml(t.vaultBalance)}</td>
<td>${escapeHtml(t.vaultValueUsd)}</td>
<td>${escapeHtml(t.exposurePct)}</td>
<td>${escapeHtml(t.riskScore)}</td>
<td>${escapeHtml(t.priceStale)}</td>
</tr>`;
  }).join("\n");
}

function renderMarketRows(markets) {
  return (markets || []).map((market) => `<tr>
<td>${escapeHtml(market.index)}</td>
<td>${escapeHtml(market.marketToken)}</td>
<td>${escapeHtml(market.indexToken)}</td>
<td>${escapeHtml(market.longToken)}</td>
<td>${escapeHtml(market.shortToken)}</td>
<td>${escapeHtml(market.marketValueUsd)}</td>
<td>${escapeHtml(market.concentrationPct)}</td>
<td>${escapeHtml(market.riskScore)}</td>
<td>${escapeHtml((market.riskFlags || []).join("; ") || "-")}</td>
</tr>`).join("\n");
}

function topRows(tokens, key, limit) {
  return [...tokens]
    .sort((a, b) => Number(b[key] === "N/A" ? 0 : b[key]) - Number(a[key] === "N/A" ? 0 : a[key]))
    .slice(0, limit);
}

function renderSimpleRows(rows) {
  return rows.map((t) => `<tr><td>${escapeHtml(t.symbol)}</td><td>${escapeHtml(t.address)}</td><td>${escapeHtml(t.riskScore)}</td><td>${escapeHtml(t.vaultValueUsd)}</td></tr>`).join("\n");
}

function renderModeRows(modes) {
  const entries = Object.entries(modes || {});
  return entries.map(([name, enabled]) => `<tr><td>${escapeHtml(name)}</td><td>${enabled ? "on" : "off"}</td></tr>`).join("\n");
}

function renderSecuritySummary(audit) {
  if (!audit.security || !audit.security.results) {
    return { high: 0, tools: 0 };
  }

  let high = 0;
  let tools = 0;
  for (const result of Object.values(audit.security.results)) {
    tools += 1;
    high += Number(result.highCount || 0);
  }

  return { high, tools };
}

function buildHtml(audit) {
  const ts = new Date(audit.block.timestamp * 1000).toISOString();
  const byRisk = topRows(audit.tokens, "riskScore", 10);
  const byUsd = topRows(audit.tokens, "vaultValueUsd", 10);
  const missingFeeds = audit.tokens.filter((t) => !t.hasFeed);
  const staleFeeds = audit.tokens.filter((t) => t.priceStale === true);
  const securitySummary = renderSecuritySummary(audit);
  const v2Summary = audit.v2 && audit.v2.marketSummary ? audit.v2.marketSummary : null;
  const executiveSummary = `Analyzed ${audit.summary.totalTokens} collateral tokens${audit.summary.tvlUsd ? ` with TVL ${audit.summary.tvlUsd} USD` : ""}. High-risk tokens: ${audit.summary.highRiskTokens}. Missing feeds: ${missingFeeds.length}. Stale feeds: ${staleFeeds.length}. Security mode: ${audit.modes && audit.modes.security ? "on" : "off"}.${v2Summary ? ` Markets: ${v2Summary.totalMarkets}. High-risk markets: ${v2Summary.highRiskMarkets}.` : ""}`;
  const gateStatus = audit.gate && audit.gate.passed ? "passed" : "failed";
  const securityPartial = audit.security && audit.security.partial ? "yes" : "no";
  const aiFindingsCount = audit.ai && Array.isArray(audit.ai.ai_findings) ? audit.ai.ai_findings.length : 0;
  const aiTop = audit.ai && Array.isArray(audit.ai.ai_findings) ? audit.ai.ai_findings.slice(0, 5) : [];
  const archiveWarning = audit.security && audit.security.partial
    ? `Security at pinned block requires archive RPC; results are partial. RPC host: ${audit.security.rpcHostRedacted || "N/A"}.`
    : null;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>GMX Vault Audit Report</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #111; }
  h1, h2 { margin: 0 0 12px; }
  .meta { margin: 0 0 18px; }
  .banner { margin: 0 0 18px; padding: 12px 14px; border: 1px solid #d97706; background: #fff7ed; color: #9a3412; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 20px; font-size: 13px; }
  th, td { border: 1px solid #d0d7de; padding: 6px 8px; text-align: left; }
  th { background: #f6f8fa; }
</style>
</head>
<body>
  <h1>GMX Vault Audit Report</h1>
  ${archiveWarning ? `<div class="banner"><b>Archive Warning:</b> ${escapeHtml(archiveWarning)}</div>` : ""}
  <p id="exec-summary"><b>Executive Summary:</b> ${escapeHtml(executiveSummary)}</p>
  <p class="meta"><b>Vault:</b> ${escapeHtml(audit.vault)}<br/>
  <b>Network:</b> ${escapeHtml(audit.network.name)} (chainId=${escapeHtml(audit.network.chainId)})<br/>
  <b>Block:</b> ${escapeHtml(audit.block.number)}<br/>
  <b>Block Hash:</b> ${escapeHtml(audit.block.hash)}<br/>
  <b>Block Time:</b> ${escapeHtml(ts)}<br/>
  <b>Evidence Manifest:</b> ${escapeHtml(audit.evidencePath || "N/A")}</p>

  <h2 id="executive-summary">Executive Snapshot</h2>
  <table id="exec-summary-table">
    <tr><th>Gate Outcome</th><th>Total Markets</th><th>Total Collateral Tokens</th><th>Missing Feed Count</th><th>Stale Feed Count</th><th>High-Risk Items</th></tr>
    <tr>
      <td>${escapeHtml(gateStatus)}</td>
      <td>${escapeHtml(v2Summary ? v2Summary.totalMarkets : "N/A")}</td>
      <td>${escapeHtml(v2Summary ? v2Summary.totalCollateralTokens : audit.summary.totalTokens)}</td>
      <td>${escapeHtml(missingFeeds.length)}</td>
      <td>${escapeHtml(staleFeeds.length)}</td>
      <td>${escapeHtml((audit.summary.highRiskTokens || 0) + (v2Summary ? v2Summary.highRiskMarkets : 0))}</td>
    </tr>
  </table>

  <h2>Mode Status</h2>
  <table>
    <tr><th>Mode</th><th>Status</th></tr>
    ${renderModeRows(audit.modes)}
  </table>

  <h2>Gate Status</h2>
  <table>
    <tr><th>Status</th><th>Reasons</th><th>Security Partial</th></tr>
    <tr>
      <td>${escapeHtml(gateStatus)}</td>
      <td>${escapeHtml(audit.gate && audit.gate.reasons ? audit.gate.reasons.join("; ") : "-")}</td>
      <td>${escapeHtml(securityPartial)}</td>
    </tr>
  </table>

  <h2>Risk Summary</h2>
  <table>
    <tr><th>Total Tokens</th><th>Avg Risk Score</th><th>High Risk Tokens</th><th>TVL USD</th></tr>
    <tr>
      <td>${escapeHtml(audit.summary.totalTokens)}</td>
      <td>${escapeHtml(audit.summary.avgRiskScore)}</td>
      <td>${escapeHtml(audit.summary.highRiskTokens)}</td>
      <td>${escapeHtml(audit.summary.tvlUsd || "N/A")}</td>
    </tr>
  </table>

  ${v2Summary ? `<h2 id="markets-risk-summary">Markets Risk Summary</h2>
  <table id="markets-risk-table">
    <tr><th>Total Markets</th><th>Missing Index Feeds</th><th>Missing Collateral Feeds</th><th>Stale Index Feeds</th><th>Zero Liquidity Markets</th><th>High-Risk Markets</th><th>Top Market Share %</th></tr>
    <tr>
      <td>${escapeHtml(v2Summary.totalMarkets)}</td>
      <td>${escapeHtml(v2Summary.missingIndexFeeds)}</td>
      <td>${escapeHtml(v2Summary.missingCollateralFeeds)}</td>
      <td>${escapeHtml(v2Summary.staleIndexFeeds)}</td>
      <td>${escapeHtml(v2Summary.zeroLiquidityMarkets)}</td>
      <td>${escapeHtml(v2Summary.highRiskMarkets)}</td>
      <td>${escapeHtml(v2Summary.topMarketSharePct)}</td>
    </tr>
  </table>

  <h2 id="v2-markets">V2 Markets</h2>
  <table id="v2-markets-table">
    <tr><th>#</th><th>Market Token</th><th>Index Token</th><th>Long Token</th><th>Short Token</th><th>Market USD</th><th>Concentration %</th><th>Risk Score</th><th>Flags</th></tr>
    ${renderMarketRows(audit.v2.markets || [])}
  </table>` : ""}

  <h2 id="token-risk-table">Token Table</h2>
  <table id="token-risk-table-grid">
    <tr><th>#</th><th>Address</th><th>Symbol</th><th>Decimals</th><th>Balance</th><th>USD Exposure</th><th>Exposure %</th><th>Risk Score</th><th>Price Stale</th></tr>
    ${renderTokenRows(audit.tokens)}
  </table>

  <h2>Top 10 By Risk</h2>
  <table>
    <tr><th>Symbol</th><th>Address</th><th>Risk Score</th><th>USD Exposure</th></tr>
    ${renderSimpleRows(byRisk)}
  </table>

  <h2>Top 10 By USD Exposure</h2>
  <table>
    <tr><th>Symbol</th><th>Address</th><th>Risk Score</th><th>USD Exposure</th></tr>
    ${renderSimpleRows(byUsd)}
  </table>

  <h2>Feed Alerts</h2>
  <table>
    <tr><th>Missing Feeds</th><th>Stale Feeds</th></tr>
    <tr><td>${missingFeeds.length}</td><td>${staleFeeds.length}</td></tr>
  </table>

  <h2>Security Results</h2>
  <table>
    <tr><th>Tool</th><th>Status</th><th>Reason</th><th>High Count</th></tr>
    ${renderSecurityRows(audit.security)}
  </table>

  <h2>Security Summary</h2>
  <table>
    <tr><th>Tools Run</th><th>Total High Findings</th></tr>
    <tr><td>${securitySummary.tools}</td><td>${securitySummary.high}</td></tr>
  </table>

  ${audit.securityLinks ? `<h2>Security Artifacts</h2>
  <ul>
    <li>Slither: <a href="${escapeHtml(audit.securityLinks.slither || "")}">${escapeHtml(audit.securityLinks.slither || "N/A")}</a></li>
    <li>Mythril: <a href="${escapeHtml(audit.securityLinks.mythril || "")}">${escapeHtml(audit.securityLinks.mythril || "N/A")}</a></li>
    <li>Normalized Findings: <a href="${escapeHtml(audit.securityLinks.normalized || "")}">${escapeHtml(audit.securityLinks.normalized || "N/A")}</a></li>
  </ul>` : ""}

  ${audit.ai ? `<h2>AI Triage</h2>
  <p><b>Status:</b> ${escapeHtml(audit.ai.status || "unknown")}<br/>
  <b>Model:</b> ${escapeHtml(audit.ai.model || "unknown")}<br/>
  <b>Schema Valid:</b> ${escapeHtml(audit.ai.schema_valid === true ? "true" : "false")}<br/>
  <b>Cache Hit:</b> ${escapeHtml(audit.ai.cache_hit === true ? "true" : "false")}<br/>
  <b>Findings:</b> ${escapeHtml(aiFindingsCount)}</p>
  <table>
    <tr><th>Id</th><th>Severity</th><th>Title</th></tr>
    ${aiTop.map((f) => `<tr><td>${escapeHtml(f.id || "N/A")}</td><td>${escapeHtml(f.severity || "N/A")}</td><td>${escapeHtml(f.title || "N/A")}</td></tr>`).join("\n")}
  </table>` : ""}
</body>
</html>`;
}

function buildMarkdown(audit) {
  const ts = new Date(audit.block.timestamp * 1000).toISOString();
  const byRisk = topRows(audit.tokens, "riskScore", 10);
  const byUsd = topRows(audit.tokens, "vaultValueUsd", 10);
  const missingFeeds = audit.tokens.filter((t) => !t.hasFeed);
  const staleFeeds = audit.tokens.filter((t) => t.priceStale === true);
  const securitySummary = renderSecuritySummary(audit);
  const v2Summary = audit.v2 && audit.v2.marketSummary ? audit.v2.marketSummary : null;
  const executiveSummary = `Analyzed ${audit.summary.totalTokens} collateral tokens${audit.summary.tvlUsd ? ` with TVL ${audit.summary.tvlUsd} USD` : ""}. High-risk tokens: ${audit.summary.highRiskTokens}. Missing feeds: ${missingFeeds.length}. Stale feeds: ${staleFeeds.length}. Security mode: ${audit.modes && audit.modes.security ? "on" : "off"}.${v2Summary ? ` Markets: ${v2Summary.totalMarkets}. High-risk markets: ${v2Summary.highRiskMarkets}.` : ""}`;
  const gateStatus = audit.gate && audit.gate.passed ? "passed" : "failed";
  const aiFindingsCount = audit.ai && Array.isArray(audit.ai.ai_findings) ? audit.ai.ai_findings.length : 0;
  const aiTop = audit.ai && Array.isArray(audit.ai.ai_findings) ? audit.ai.ai_findings.slice(0, 5) : [];
  const archiveWarning = audit.security && audit.security.partial
    ? `Security at pinned block requires archive RPC; results are partial. RPC host: ${audit.security.rpcHostRedacted || "N/A"}.`
    : null;

  const tokenLines = audit.tokens.map((t) =>
    `| ${t.index} | ${t.address} | ${t.symbol} | ${t.decimals} | ${t.vaultBalance} | ${t.vaultValueUsd} | ${t.exposurePct}% | ${t.riskScore} | ${t.priceStale} |`
  );
  const marketLines = audit.v2 && Array.isArray(audit.v2.markets)
    ? audit.v2.markets.map((m) => `| ${m.index} | ${m.marketToken} | ${m.indexToken} | ${m.longToken} | ${m.shortToken} | ${m.marketValueUsd} | ${m.concentrationPct}% | ${m.riskScore} | ${(m.riskFlags || []).join("; ") || "-"} |`)
    : [];

  let securityLines = "| Tool | Status | Reason | High Count |\n| --- | --- | --- | --- |\n| N/A | skipped | pipeline not executed | 0 |";
  if (audit.security && audit.security.results) {
    const lines = ["| Tool | Status | Reason | High Count |", "| --- | --- | --- | --- |"];
    for (const [tool, result] of Object.entries(audit.security.results)) {
      lines.push(`| ${tool} | ${result.status} | ${result.reason || "-"} | ${result.highCount || 0} |`);
    }
    securityLines = lines.join("\n");
  }

  return `# GMX Vault Audit Report

  ${archiveWarning ? `> WARNING: ${archiveWarning}\n` : ""}

## Executive Summary

${executiveSummary}

- Vault: ${audit.vault}
- Network: ${audit.network.name} (chainId=${audit.network.chainId})
- Block: ${audit.block.number}
- Block Hash: ${audit.block.hash}
- Block Time: ${ts}
- Evidence Manifest: ${audit.evidencePath || "N/A"}

## Executive Snapshot

| Gate Outcome | Total Markets | Total Collateral Tokens | Missing Feed Count | Stale Feed Count | High-Risk Items |
| --- | --- | --- | --- | --- | --- |
| ${gateStatus} | ${v2Summary ? v2Summary.totalMarkets : "N/A"} | ${v2Summary ? v2Summary.totalCollateralTokens : audit.summary.totalTokens} | ${missingFeeds.length} | ${staleFeeds.length} | ${(audit.summary.highRiskTokens || 0) + (v2Summary ? v2Summary.highRiskMarkets : 0)} |

## Mode Status

| Mode | Status |
| --- | --- |
${Object.entries(audit.modes || {}).map(([k, v]) => `| ${k} | ${v ? "on" : "off"} |`).join("\n")}

## Gate Status

| Status | Reasons | Security Partial |
| --- | --- | --- |
| ${gateStatus} | ${(audit.gate && audit.gate.reasons ? audit.gate.reasons.join("; ") : "-" )} | ${audit.security && audit.security.partial ? "yes" : "no"} |

## Risk Summary

| Total Tokens | Avg Risk Score | High Risk Tokens | TVL USD |
| --- | --- | --- | --- |
| ${audit.summary.totalTokens} | ${audit.summary.avgRiskScore} | ${audit.summary.highRiskTokens} | ${audit.summary.tvlUsd || "N/A"} |

${v2Summary ? `## Markets Risk Summary

| Total Markets | Missing Index Feeds | Missing Collateral Feeds | Stale Index Feeds | Zero Liquidity Markets | High-Risk Markets | Top Market Share % |
| --- | --- | --- | --- | --- | --- | --- |
| ${v2Summary.totalMarkets} | ${v2Summary.missingIndexFeeds} | ${v2Summary.missingCollateralFeeds} | ${v2Summary.staleIndexFeeds} | ${v2Summary.zeroLiquidityMarkets} | ${v2Summary.highRiskMarkets} | ${v2Summary.topMarketSharePct}% |

## V2 Markets

| # | Market Token | Index Token | Long Token | Short Token | Market USD | Concentration % | Risk Score | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${marketLines.join("\n")}

` : ""}

## Token Table

| # | Address | Symbol | Decimals | Balance | USD Exposure | Exposure % | Risk Score | Price Stale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${tokenLines.join("\n")}

## Top 10 By Risk

| Symbol | Address | Risk Score | USD Exposure |
| --- | --- | --- | --- |
${byRisk.map((t) => `| ${t.symbol} | ${t.address} | ${t.riskScore} | ${t.vaultValueUsd} |`).join("\n")}

## Top 10 By USD Exposure

| Symbol | Address | Risk Score | USD Exposure |
| --- | --- | --- | --- |
${byUsd.map((t) => `| ${t.symbol} | ${t.address} | ${t.riskScore} | ${t.vaultValueUsd} |`).join("\n")}

## Feed Alerts

- Missing feeds: ${missingFeeds.length}
- Stale feeds: ${staleFeeds.length}

## Security Results

${securityLines}

## Security Summary

- Tools run: ${securitySummary.tools}
- Total high findings: ${securitySummary.high}

${audit.securityLinks ? `## Security Artifacts

- Slither: ${audit.securityLinks.slither || "N/A"}
- Mythril: ${audit.securityLinks.mythril || "N/A"}
- Normalized Findings: ${audit.securityLinks.normalized || "N/A"}
` : ""}

${audit.ai ? `## AI Triage

- Status: ${audit.ai.status || "unknown"}
- Model: ${audit.ai.model || "unknown"}
- Schema Valid: ${audit.ai.schema_valid === true ? "true" : "false"}
- Cache Hit: ${audit.ai.cache_hit === true ? "true" : "false"}
- Findings: ${aiFindingsCount}

| Id | Severity | Title |
| --- | --- | --- |
${aiTop.map((f) => `| ${f.id || "N/A"} | ${f.severity || "N/A"} | ${f.title || "N/A"} |`).join("\n")}
` : ""}
`;
}

function generateReports(audit, options) {
  const result = {
    htmlPath: null,
    markdownPath: null
  };

  if (options.htmlPath) {
    const htmlPath = resolveReportPath(options.htmlPath, "html");
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, buildHtml(audit), "utf8");
    result.htmlPath = htmlPath;
  }

  if (options.markdownPath) {
    const markdownPath = resolveReportPath(options.markdownPath, "md");
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    fs.writeFileSync(markdownPath, buildMarkdown(audit), "utf8");
    result.markdownPath = markdownPath;
  }

  return result;
}

module.exports = {
  generateReports
};
