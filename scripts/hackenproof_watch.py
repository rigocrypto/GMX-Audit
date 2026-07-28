#!/usr/bin/env python3
"""Weekly HackenProof target watcher.

Maintains a curated shortlist of HackenProof smart-contract programs at <=80
reputation, scores them against the "worth active hunting" rubric, and emits a
weekly report + machine-readable snapshot with week-over-week deltas.

The PROGRAMS list is intentionally explicit (curated), not scraped: HackenProof
program pages are JS-rendered and gated, so a hand-maintained list gives a
stable, honest signal. Update PROGRAMS as new scopes appear; the scoring +
delta detection then flags what changed.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path("data")
REPORTS_DIR = Path("reports")
DATA_DIR.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)

SNAPSHOT_FILE = DATA_DIR / "hackenproof_snapshot.json"
REPORT_FILE = REPORTS_DIR / "hackenproof_weekly_report.md"

# Curated watch list. Fields drive scoring; `status` records our own assessment.
# status: NEW | WATCH | PAUSED | CLOSED-NO-FINDING
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
        "status": "PAUSED",
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
]


def load_previous():
    if SNAPSHOT_FILE.exists():
        try:
            return json.loads(SNAPSHOT_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"generated_at": None, "programs": []}


def score_program(p):
    score = 0
    # Accessibility
    if p.get("reputation_required", 999) <= 80:
        score += 2
    # Smart contracts
    if p.get("type") == "smart-contracts":
        score += 2
    # Solidity/EVM preference
    if p.get("ecosystem") == "EVM":
        score += 3
    # Reward weight
    critical = p.get("critical_bounty_usd", 0)
    if critical >= 150000:
        score += 5
    elif critical >= 50000:
        score += 3
    elif critical >= 10000:
        score += 1
    # Note-based bonuses/penalties
    notes = (p.get("notes") or "").lower()
    if "toolchain-heavy" in notes:
        score -= 2
    if "saturated" in notes:
        score -= 3
    if "paid history" in notes:
        score += 2
    if "public source" in notes:
        score += 2
    # Our own status: already-closed/paused programs are not fresh EV
    status = (p.get("status") or "").upper()
    if status == "CLOSED-NO-FINDING":
        score -= 6
    elif status == "PAUSED":
        score -= 4
    elif status == "NEW":
        score += 4
    return score


def classify(score):
    if score >= 10:
        return "HIGH"
    if score >= 6:
        return "MEDIUM"
    return "LOW"


def build_snapshot():
    snapshot = {"generated_at": datetime.now(timezone.utc).isoformat(), "programs": []}
    for p in PROGRAMS:
        entry = dict(p)
        entry["score"] = score_program(p)
        entry["priority"] = classify(entry["score"])
        snapshot["programs"].append(entry)
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
            fields = [
                f
                for f in ["reputation_required", "critical_bounty_usd", "score", "priority", "notes", "status"]
                if prev_map[n].get(f) != curr_map[n].get(f)
            ]
            if fields:
                changed.append((n, fields, prev_map[n], curr_map[n]))
    return added, removed, changed


def write_report(curr, added, removed, changed):
    L = ["# Weekly HackenProof Watch", "", f"Generated: {curr['generated_at']}", ""]
    L += ["## Shortlist (scored)", "", "| Program | Rep | Eco | Critical | Score | Priority | Status | Notes |", "|---|---:|---|---:|---:|---|---|---|"]
    for p in curr["programs"]:
        L.append(
            f"| [{p['name']}]({p['url']}) | {p['reputation_required']} | {p['ecosystem']} | "
            f"${p['critical_bounty_usd']:,} | {p['score']} | {p['priority']} | {p.get('status','')} | {p['notes']} |"
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
            L += ["", "### Changed"] + [f"- **{n}**: {', '.join(fs)}" for n, fs, _o, _nw in changed]
    L += ["", "## Recommended Action", ""]
    fresh = [p for p in curr["programs"] if (p.get("status") or "").upper() in ("NEW", "WATCH")]
    if fresh and fresh[0]["priority"] in ("HIGH", "MEDIUM"):
        b = fresh[0]
        L.append(f"Investigate: **{b['name']}** ({b['priority']}, score {b['score']}) — clears the freshness/EV bar.")
    else:
        L.append("No fresh candidate clears the bar this week. Hold active hunting; keep watching. "
                 "Add newly launched ≤80-rep smart-contract programs to `PROGRAMS` as they appear.")
    REPORT_FILE.write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    prev = load_previous()
    curr = build_snapshot()
    added, removed, changed = compare(prev, curr)
    SNAPSHOT_FILE.write_text(json.dumps(curr, indent=2) + "\n", encoding="utf-8")
    write_report(curr, added, removed, changed)
    print(f"Wrote {SNAPSHOT_FILE} and {REPORT_FILE}. {len(curr['programs'])} programs; "
          f"+{len(added)} / -{len(removed)} / ~{len(changed)} changes.")


if __name__ == "__main__":
    main()
