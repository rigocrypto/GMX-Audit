/**
 * Deduplicated GitHub incident issue for billing-service outages.
 *
 * This is the notification/state fallback that makes an outage impossible to
 * miss even when no webhook or SMTP channel is configured — an outage cannot
 * live only as a red GitHub Actions run. The open issue itself is the durable
 * incident record (GitHub Actions runners are ephemeral, so we deliberately do
 * NOT rely on a state file that survives across runs).
 *
 * Flow:
 *   - detect    -> ensureIncidentOpen(): open ONE issue per incident (dedup by
 *                  label + marker); never one issue per failed run.
 *   - escalate  -> after `escalateAfterMinutes`, add a single escalation comment
 *                  and the `status:escalated` label (once per incident).
 *   - recover   -> resolveIncident(): comment recovery and close the open issue.
 *
 * All functions are no-ops (action: "skipped") when no GitHub token/repo is
 * available, so local runs and tests do not touch the API.
 */

export const INCIDENT_LABEL = "billing-incident";
export const ESCALATED_LABEL = "status:escalated";
const INCIDENT_MARKER = "<!-- billing-health-incident -->";
const GITHUB_API = "https://api.github.com";

export type GithubContext = {
  token: string;
  owner: string;
  repo: string;
  serverUrl: string;
  runId?: string;
};

export type IncidentDetail = {
  healthUrl: string;
  status: number;
  probes: number;
};

/**
 * Reduce a URL to its host only for use in PUBLIC issue bodies.
 * Strips scheme, path, query string, fragment, and any embedded userinfo, so a
 * health URL configured with a token (`?token=…` or `user:pass@…`) can never
 * leak into a public GitHub issue. Falls back to a generic label on bad input.
 */
export function sanitizeEndpoint(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "billing health endpoint";
  }
}

type OpenIncident = {
  number: number;
  createdAt: string;
  labels: string[];
};

export type EnsureResult = {
  action: "created" | "escalated" | "ongoing" | "skipped";
  issueNumber?: number;
};

export type ResolveResult = {
  action: "closed" | "none" | "skipped";
  issueNumber?: number;
};

/** Build the GitHub context from the standard Actions env, or null if unavailable. */
export function githubContextFromEnv(): GithubContext | null {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const repository = (process.env.GITHUB_REPOSITORY || "").trim();
  if (!token || !repository.includes("/")) {
    return null;
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return null;
  }
  return {
    token,
    owner,
    repo,
    serverUrl: (process.env.GITHUB_SERVER_URL || "https://github.com").trim(),
    runId: process.env.GITHUB_RUN_ID?.trim() || undefined
  };
}

async function api<T>(
  ctx: GithubContext,
  method: string,
  path: string,
  payload?: unknown
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "billing-health-alert"
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`github_api_failed ${method} ${path} status=${response.status} body=${text.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

function runUrl(ctx: GithubContext): string {
  if (!ctx.runId) {
    return "(local run)";
  }
  return `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${ctx.runId}`;
}

async function findOpenIncident(ctx: GithubContext): Promise<OpenIncident | null> {
  const issues = await api<Array<{ number: number; created_at: string; body: string | null; labels: Array<string | { name?: string }> }>>(
    ctx,
    "GET",
    `/repos/${ctx.owner}/${ctx.repo}/issues?state=open&labels=${encodeURIComponent(INCIDENT_LABEL)}&per_page=50`
  );

  const match = issues.find((issue) => String(issue.body || "").includes(INCIDENT_MARKER));
  if (!match) {
    return null;
  }

  return {
    number: match.number,
    createdAt: match.created_at,
    labels: (match.labels || [])
      .map((label) => (typeof label === "string" ? label : label.name || ""))
      .filter(Boolean)
  };
}

// Renders ONLY sanitized operational facts into the public issue body:
// service host (no scheme/path/query/userinfo), the HTTP status class, and the
// probe count. It deliberately never includes response bodies, exception
// messages, headers, environment values, or full/internal URLs.
function detailBlock(detail: IncidentDetail): string {
  return [
    `- Service host: ${sanitizeEndpoint(detail.healthUrl)}`,
    `- Observed status: ${detail.status === 0 ? "unreachable / network error" : detail.status}`,
    `- Consecutive failed probes this run: ${detail.probes}`
  ].join("\n");
}

async function comment(ctx: GithubContext, issueNumber: number, body: string): Promise<void> {
  await api(ctx, "POST", `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}/comments`, { body });
}

/**
 * Ensure exactly one open incident issue exists for an ongoing outage.
 * Creates on first confirmed outage, escalates once past the threshold, and is
 * otherwise a quiet no-op (`ongoing`) so we never spam one comment per run.
 */
export async function ensureIncidentOpen(
  ctx: GithubContext,
  detail: IncidentDetail,
  escalateAfterMinutes: number
): Promise<EnsureResult> {
  const existing = await findOpenIncident(ctx);

  if (!existing) {
    const created = await api<{ number: number }>(ctx, "POST", `/repos/${ctx.owner}/${ctx.repo}/issues`, {
      title: `[billing] health check failing — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      body: [
        INCIDENT_MARKER,
        "## Billing webhook outage",
        "",
        "Automated health monitoring confirmed the billing webhook `/health` endpoint is failing.",
        "",
        detailBlock(detail),
        `- First detected: ${new Date().toISOString()}`,
        `- Detected by run: ${runUrl(ctx)}`,
        "",
        "This issue is **deduplicated**: it stays open for the whole incident and is",
        "closed automatically when `/health` recovers. It will not be reopened per failed run.",
        "",
        "### Runbook",
        "1. Check Railway service `billing-webhook` (deploy status, crash loop, health logs).",
        "2. `railway logs --service billing-webhook --lines 200`.",
        "3. Confirm `GET /health` returns `200 {\"ok\":true}` once restored — this issue then closes on its own."
      ].join("\n"),
      labels: [INCIDENT_LABEL]
    });
    return { action: "created", issueNumber: created.number };
  }

  const ageMinutes = (Date.now() - new Date(existing.createdAt).getTime()) / 60000;
  const alreadyEscalated = existing.labels.includes(ESCALATED_LABEL);

  if (!alreadyEscalated && ageMinutes >= escalateAfterMinutes) {
    await api(ctx, "POST", `/repos/${ctx.owner}/${ctx.repo}/issues/${existing.number}/labels`, {
      labels: [ESCALATED_LABEL]
    });
    await comment(
      ctx,
      existing.number,
      [
        `## ⚠️ Escalation — still down after ~${Math.round(ageMinutes)} min`,
        "",
        detailBlock(detail),
        `- Escalated at: ${new Date().toISOString()}`,
        `- Run: ${runUrl(ctx)}`,
        "",
        "The billing webhook has not recovered within the escalation window. Manual intervention required."
      ].join("\n")
    );
    return { action: "escalated", issueNumber: existing.number };
  }

  // Ongoing outage, already tracked and not yet at escalation — stay quiet to avoid noise.
  return { action: "ongoing", issueNumber: existing.number };
}

/** Close the open incident issue (if any) with a recovery comment. */
export async function resolveIncident(ctx: GithubContext, detail: IncidentDetail): Promise<ResolveResult> {
  const existing = await findOpenIncident(ctx);
  if (!existing) {
    return { action: "none" };
  }

  const downForMinutes = Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 60000);
  await comment(
    ctx,
    existing.number,
    [
      "## ✅ Recovered",
      "",
      `Health check on \`${sanitizeEndpoint(detail.healthUrl)}\` is healthy again (status ${detail.status}).`,
      `- Recovered at: ${new Date().toISOString()}`,
      `- Approx. incident duration: ~${downForMinutes} min`,
      `- Confirmed by run: ${runUrl(ctx)}`,
      "",
      "Closing this incident automatically."
    ].join("\n")
  );

  await api(ctx, "PATCH", `/repos/${ctx.owner}/${ctx.repo}/issues/${existing.number}`, {
    state: "closed",
    state_reason: "completed"
  });

  return { action: "closed", issueNumber: existing.number };
}
