#!/usr/bin/env python3
"""Weekly HackenProof target watcher (v2).

Maintains a curated shortlist of HackenProof smart-contract programs at <=80
reputation, scores them against the "worth active hunting" rubric, and emits a
weekly report + JSON/CSV snapshots with week-over-week deltas, a
"new-since-last-week" flag, and an alert file that a CI step turns into a
GitHub Issue for new HIGH-priority targets.

Design notes:
- The PROGRAMS list is curated (authoritative for economics/scope), because
  HackenProof pages are JS-rendered/gated and unreliable to scrape. The
  optional web-reachability probe NEVER overrides curated data — it only
  records HTTP reachability so a dead/changed URL is visible. Set
  WATCH_PROBE_WEB=0 to skip it.
"""
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path("data")
REPORTS_DIR = Path("reports")
DATA_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)

SNAPSHOT_FILE = DATA_DIR / "hackenproof_snapshot.json"
CSV_FILE = DATA_DIR / "hackenproof_snapshot.csv"
ALERT_FILE = DATA_DIR / "hackenproof_alert.json"
REPORT_FILE = REPORTS_DIR / "hackenproof_weekly_report.md"

# Curated watch list. status: NEW | WATCH | PAUSED | PAUSED-WATCH | PAUSED-TOOLCHAIN | CLOSED-NO-FINDING
PROGRAMS = [
    {
        "name": "ShapeShift",
        "url": "https://hackenproof.com/programs/shapeshift",
        "reputation_required": 50,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 10000,
        "status": "CLOSED-NO-FINDING",
        "notes": "public source, paid history; rFOX StakingV1 == audited, invariants hold. low max bounty.",
    },
    {
        "name": "RISC Zero Blockchain Verifiers",
        "url": "https://hackenproof.com/programs/risc-zero-blockchain-verifiers",
        "reputation_required": 50,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 150000,
        "status": "PAUSED-TOOLCHAIN",
        "notes": "high-value verifier scope, toolchain-heavy; contract surface clean/audit-saturated. paused-toolchain-gate.",
    },
    {
        "name": "Cronos Smart Contracts",
        "url": "https://hackenproof.com/programs/cronos-smart-contracts",
        "reputation_required": 50,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 200000,
        "status": "CLOSED-NO-FINDING",
        "notes": "saturated ($0 paid, 146 subs); Fulcrom/Tectonic/Veno faithful forks or privileged. low EV unless scope changes.",
    },
    {
        "name": "Whitechain Bridge",
        "url": "https://hackenproof.com/programs/whitechain-bridge",
        "reputation_required": 50,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 100000,
        "status": "CLOSED-NO-FINDING",
        "notes": "centralized bridge; signature domain gap refuted by distinct relayers.",
    },
    {
        "name": "SuperEarn Web & Smart Contracts",
        "url": "https://hackenproof.com/programs/superearn-web-and-smart-contracts",
        "reputation_required": None,  # UNCONFIRMED — verify <=80 before treating as accessible
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 30000,
        "status": "PAUSED-WATCH",
        "reopen_priority": "HIGH",
        "notes": ("PAUSED-WATCH, HIGH on reopening. Custom cross-chain vault/accounting (Kaia CooldownVault/"
                  "OriginVault/BridgeAccountant <-> Ethereum RemoteVault); public source superearn-io/"
                  "superearn-core-public; permissionless flows; direct fund-safety invariants. Foundry-fork "
                  "reproducible. Saturation HIGH (249 subs, $2.8k paid, 3 Certik reviews). Strategy: "
                  "DEPLOYMENT-DIFF FIRST. Rep UNCONFIRMED — confirm <=80. See targets/superearn/reports/"
                  "reopen-checklist.md. Do NOT assess while paused."),
    },
    {
        "name": "Hyperbridge Protocol",
        "url": "https://hackenproof.com/programs/hyperbridge-protocol",
        "reputation_required": None,  # no public requirement displayed
        "access_confirmed": True,     # access confirmed (repos cloned/built locally)
        "type": "smart-contracts",
        "ecosystem": "EVM/Rust",
        "critical_bounty_usd": 50000,
        "status": "PAUSED-TOOLCHAIN",
        "notes": ("PAUSED-TOOLCHAIN. paid $152.5k, 2102 submissions; Solidity Merkle v1.1.0 hardened and "
                  "independently reconciled (22/22 + 3/3 differential). Residual Rust/ISMP/proxy surface "
                  "BLOCKED by missing cargo/rustc and lacks a specific consumer-binding lead. Reopen only "
                  "with a reproducible Rust toolchain + working Rust/Solidity fixtures + a concrete "
                  "commitment/timeout/proxy/MPT hypothesis not already regression-covered."),
    },
    {
        "name": "Strata",
        "url": "https://immunefi.com/bug-bounty/strata/information/",
        "reputation_required": 0,
        "access_confirmed": True,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 250000,
        "status": "WATCH",
        "notes": ("Phase 0 clean at commit 07fb443. June-2026 cooldown/CDO/RoundingGuard/UD60x18Ext scope "
                  "additions postdate the March audits. Revisit on deployment change, new audit, known-issue "
                  "update, or scope expansion. Immunefi (not HackenProof)."),
    },
    {
        "name": "Yearn V3 - Sherlock",
        "url": "https://audits.sherlock.xyz/bug-bounties/30",
        "reputation_required": 0,
        "access_confirmed": True,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 200000,
        "status": "WATCH",
        "notes": ("Phase 0 clean at 6c4ccc8. Base Vault.vy/TokenizedStrategy.sol/BaseStrategy.sol excluded as "
                  "Immunefi duplicates; yRoboTreasury custom paths reduce to trusted roles + accepted auction "
                  "risks. Sherlock scope is DYNAMIC (yearn.fi/v3). Revisit when a custom strategy is added, "
                  "yRoboTreasury changes, or a strategy introduces custom valuation/withdrawal/reporting logic."),
    },
    {
        "name": "GMX v2 - Immunefi",
        "url": "https://immunefi.com/bug-bounty/gmx/information/",
        "reputation_required": 0,
        "access_confirmed": True,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 5000000,
        "status": "WATCH",
        "notes": ("Pending/lent-impact Phase 0 clean at 2b08e88. Live v2.2 mechanism reconciled on "
                  "Arbitrum: split/full decreases telescope, full close clears pending impact, lent "
                  "impact is symmetric, GM valuation and withdrawal caps are consistent. Revisit on "
                  "deployed increase-path changes, liquidation/ADL changes, GLV aggregation changes, "
                  "or a market with active nonzero lent impact."),
    },
    {
        "name": "Exactly - Immunefi",
        "url": "https://immunefi.com/bug-bounty/exactly/information/",
        "reputation_required": 0,
        "access_confirmed": True,
        "type": "smart-contracts",
        "ecosystem": "EVM",
        "critical_bounty_usd": 25000,
        "status": "WATCH",
        "notes": ("Phase 0 clean at commit on audit/exactly-phase0. Exa smart-account stack (exactly/exa): "
                  "value paths reduce to trusted keeper/collector/issuer roles + consume-once timelocked "
                  "ProposalManager queue; receiveFlashLoan lead refuted by flashLoaner+flashLoaning-hash guard "
                  "in ExaPluginExtension; InstallmentsRouter is borrow-only (no repay/rollover accounting). "
                  "Low $25k ceiling + 20+ audits. Revisit on redeployed ExaPlugin/ProposalManager/Extension "
                  "diverging in proposal-binding/flashloan-guard/collector-issuer auth, or new Market/DebtManager "
                  "impl changing fixed-pool/liquidation/bad-debt accounting."),
    },
]

SCORE_FIELDS = ["reputation_required", "critical_bounty_usd", "score", "priority", "notes", "status"]


def load_previous():
    if SNAPSHOT_FILE.exists():
        try:
            return json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"generated_at": None, "programs": []}


def score_program(p):
    score = 0
    rep = p.get("reputation_required")
    # Accessibility bonus when access is confirmed, or the requirement is a
    # confirmed number <= 80. None/unknown without access_confirmed => not assumed accessible.
    if p.get("access_confirmed") or (isinstance(rep, int) and rep <= 80):
        score += 2
    if p.get("type") == "smart-contracts":
        score += 2
    if p.get("ecosystem") == "EVM":
        score += 3
    critical = p.get("critical_bounty_usd", 0)
    if critical >= 150000:
        score += 5
    elif critical >= 50000:
        score += 3
    elif critical >= 10000:
        score += 1
    notes = (p.get("notes") or "").lower()
    if "toolchain-heavy" in notes:
        score -= 2
    if "saturated" in notes:
        score -= 3
    if "paid history" in notes:
        score += 2
    if "public source" in notes:
        score += 2
    status = (p.get("status") or "").upper()
    if status == "CLOSED-NO-FINDING":
        score -= 6
    elif status in ("PAUSED", "PAUSED-WATCH", "PAUSED-TOOLCHAIN"):
        score -= 4  # tracked, but not actionable while paused (no submission channel)
    elif status == "NEW":
        score += 4
    return score


def classify(score):
    if score >= 10:
        return "HIGH"
    if score >= 6:
        return "MEDIUM"
    return "LOW"


def probe_web(url):
    """Best-effort reachability probe. Never affects scoring; only records status.
    Fully fault-tolerant: returns a short string. Skipped if WATCH_PROBE_WEB=0."""
    if os.environ.get("WATCH_PROBE_WEB", "1") == "0":
        return "skipped"
    try:
        import requests  # optional dependency
        r = requests.get(url, timeout=10, headers={"User-Agent": "hackenproof-watch/2.0"})
        return f"http-{r.status_code}"
    except Exception as e:  # noqa: BLE001 - reachability probe must never break the run
        return f"error:{type(e).__name__}"


def build_snapshot(prev):
    prev_names = {p["name"] for p in prev.get("programs", [])}
    snapshot = {"generated_at": datetime.now(timezone.utc).isoformat(), "programs": []}
    for p in PROGRAMS:
        e = dict(p)
        e["score"] = score_program(p)
        e["priority"] = classify(e["score"])
        e["web_reachability"] = probe_web(p["url"])
        # new-since-last-week: not present before, or explicitly flagged NEW
        e["new_since_last_week"] = (p["name"] not in prev_names) or ((p.get("status") or "").upper() == "NEW")
        snapshot["programs"].append(e)
    snapshot["programs"].sort(key=lambda x: x["score"], reverse=True)
    return snapshot


def compare(prev, curr):
    prev_map = {p["name"]: p for p in prev.get("programs", [])}
    curr_map = {p["name"]: p for p in curr.get("programs", [])}
    added = [curr_map[n] for n in curr_map if n not in prev_map]
    removed = [prev_map[n] for n in prev_map if n not in curr_map]
    changed = []
    for n in curr_map:
        if n in prev_map:
            fields = [f for f in SCORE_FIELDS if prev_map[n].get(f) != curr_map[n].get(f)]
            if fields:
                changed.append((n, fields))
    return added, removed, changed


def write_csv(curr):
    cols = ["name", "url", "reputation_required", "ecosystem", "critical_bounty_usd",
            "score", "priority", "status", "new_since_last_week", "web_reachability", "notes"]
    with CSV_FILE.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for p in curr["programs"]:
            w.writerow(p)


def write_alert(curr):
    """Alert = new-since-last-week candidates that clear the HIGH/MEDIUM bar and
    are actionable (status NEW/WATCH). CI turns this into a GitHub Issue."""
    alerts = [
        p for p in curr["programs"]
        if p.get("new_since_last_week")
        and p.get("priority") in ("HIGH", "MEDIUM")
        and (p.get("status") or "").upper() in ("NEW", "WATCH")
    ]
    ALERT_FILE.write_text(json.dumps({"generated_at": curr["generated_at"], "alerts": alerts}, indent=2) + "\n", encoding="utf-8")
    return alerts


def write_report(curr, added, removed, changed, alerts):
    L = ["# Weekly HackenProof Watch", "", f"Generated: {curr['generated_at']}", ""]
    L += ["## Shortlist (scored)", "",
          "| Program | Rep | Eco | Critical | Score | Priority | Status | New? | Web | Notes |",
          "|---|---:|---|---:|---:|---|---|:--:|---|---|"]
    for p in curr["programs"]:
        rep_disp = p["reputation_required"] if p.get("reputation_required") is not None else "?"
        L.append(
            f"| [{p['name']}]({p['url']}) | {rep_disp} | {p['ecosystem']} | "
            f"${p['critical_bounty_usd']:,} | {p['score']} | {p['priority']} | {p.get('status','')} | "
            f"{'🆕' if p.get('new_since_last_week') else ''} | {p.get('web_reachability','')} | {p['notes']} |"
        )
    L += ["", "## Changes Since Last Run", ""]
    if not (added or removed or changed):
        L.append("No changes detected.")
    else:
        if added:
            L += ["### Added"] + [f"- {p['name']} (score {p['score']}, {p['priority']})" for p in added]
        if removed:
            L += ["", "### Removed"] + [f"- {p['name']}" for p in removed]
        if changed:
            L += ["", "### Changed"] + [f"- **{n}**: {', '.join(fs)}" for n, fs in changed]
    L += ["", "## Alerts (new HIGH/MEDIUM, actionable)", ""]
    if alerts:
        for a in alerts:
            L.append(f"- **{a['name']}** — {a['priority']} (score {a['score']}), rep {a['reputation_required']}, "
                     f"critical ${a['critical_bounty_usd']:,}. {a['notes']}")
    else:
        L.append("None. No fresh candidate clears the bar this week — hold active hunting; keep watching. "
                 "Add newly launched ≤80-rep smart-contract programs to `PROGRAMS` with `status: NEW`.")
    REPORT_FILE.write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    prev = load_previous()
    curr = build_snapshot(prev)
    added, removed, changed = compare(prev, curr)
    alerts = write_alert(curr)
    SNAPSHOT_FILE.write_text(json.dumps(curr, indent=2) + "\n", encoding="utf-8")
    write_csv(curr)
    write_report(curr, added, removed, changed, alerts)
    print(f"Wrote snapshot(json/csv), report, alert. {len(curr['programs'])} programs; "
          f"+{len(added)} / -{len(removed)} / ~{len(changed)}; {len(alerts)} alert(s).")


if __name__ == "__main__":
    main()
