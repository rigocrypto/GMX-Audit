export type PendingReason =
  | "feature_not_deployed"
  | "access_gated"
  | "oracle_gated"
  | "chain_config_missing"
  | "unknown";

export interface RunData {
  timestamp: number;
  chain: string;
  block: number;
  passing: number;
  pending: number;
  failing: number;
  proof_count: number;
  duration_ms: number;
  unexplained_pending: number;
  security_score: number;
  log_path?: string;
  notes?: string;
}

export function computeSecurityScore(run: {
  failing: number;
  proof_count: number;
  unexplained_pending?: number;
}): number {
  let score = 100;
  score -= run.failing * 30;
  score -= run.proof_count * 50;
  score -= (run.unexplained_pending ?? 0) * 5;
  return Math.max(0, score);
}

export function classifyPending(testName: string, skipReason?: string): PendingReason {
  if (/GLV|Subaccount|subaccount/i.test(testName)) return "feature_not_deployed";
  if (/forbidden|GlpManager|Unauthorized|onlyRole/i.test(skipReason ?? "")) return "access_gated";
  if (/oracle|MaxRefPrice|OracleTimestamp/i.test(skipReason ?? "")) return "oracle_gated";
  if (/address|chain|config|missing/i.test(skipReason ?? "")) return "chain_config_missing";
  return "unknown";
}

export function scoreBadgeColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "#f59e0b";
  return "#ef4444";
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Degraded";
  return "Critical";
}