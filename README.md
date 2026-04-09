# gmx-audit

Deterministic GMX security harness for invariant hunting, continuous regression, and Immunefi-ready proof packaging — with an optional managed service for protocol teams.

[![Bounty Rotation](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml)
[![Audit Batch CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml)
[![Secret Scan](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml)

**Start now (Growth $499/mo):** [Checkout on Stripe](https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00)

---

## Docs

* Continuous operations: `docs/continuous-security.md`
* Managed service: `docs/managed-service.md`
* Security policy: `SECURITY.md`
* Contributing: `CONTRIBUTING.md`
* License: MIT (`LICENSE`)

---

## Who this is for

### Protocol teams (GMX forks / perps / DeFi)

You need security monitoring that's **continuous, explainable, and actionable**:

* Nightly regression scans
* A trackable "Security Score"
* Alerts when real economic invariants break
* Reproducible evidence bundles for escalation

---

### Hunters / auditors

You want:

* Deterministic fork-based execution on historical blocks
* Automated triage and severity classification
* Proof packaging + Immunefi-ready reports in minutes

---

### Enterprise security / ops

You care about:

* Repeatable runs with stored artifacts
* Minimal manual overhead
* Clear outputs for escalation and reporting

---

## What you get

### 1) Deterministic proof → submission-ready package

When a run produces a valid candidate, you get a fully reproducible bundle:

* `proof.json` + `summary.json`
* `repro.sh` + `repro.ps1` (exact commands)
* `immunefi-report.md` (ready to submit)

Includes:

* Signed USD impact (`+$ attacker gain / -$ protocol loss`)
* ETH price basis recorded at runtime

### 2) Continuous regression + Security Score

For ongoing monitoring:

* Static HTML dashboard (no CDN)
* SQLite-backed history
* Trend charts across runs
* Filters (chain, block, proofs-only, failures-only)

The score is deterministic and designed to be understandable by non-security stakeholders.

### 3) CI automation (multi-chain)

GitHub Actions workflows provide:

* Scheduled runs
* Versioned triage output (`schema_version`)
* Safe deduplication (content hash vs identity)
* Secret scanning on PRs

### 4) Managed / hosted mode (optional)

If you don't want to operate the system:

* Multi-client configuration
* Scheduled execution
* Token-protected dashboards
* Alerts + artifacts per run
* Retention pruning, retries, overlap locks

---

## Real-World Coverage

This framework has been validated against live DeFi systems under real market conditions.

Tested against production protocols, including:

### Moonwell (Compound v2 fork on Base)

Coverage includes:

* Comptroller risk checks (liquidity / shortfall)
* Oracle integration (Chainlink feeds)
* Liquidation flows (close factor, seize math)
* Stale price edge cases (missing freshness validation)

Example finding class:

* Missing oracle freshness window allowing overborrowing and persistent insolvency

Proof characteristics:

Observed impact (example run):

* Debt: ~$5.49M
* Collateral: ~$2.39M
* Deficit: ~$3.09M

Liquidation reduces risk but does not restore solvency.

See `outputs/` for proof bundles and reproducible test cases.

### Legion (Sealed-Bid Auction)

Coverage includes:

* Settlement publication and withdrawal solvency consistency
* Refund-liability accounting vs project-withdrawable accounting
* Post-settlement claim reachability under valid Merkle proofs
* Lifecycle reachability from publish -> withdraw -> refund claim

Example finding class:

* Capital conservation violation: contradictory settlement state is accepted without revert, enabling full withdrawal while valid refund obligations remain

Proof characteristics:

* Deterministic insolvency condition after valid flow
* Refund claims can become permanently unclaimable due to depleted sale balance
* Reproducible High-severity report with commit-pinned links and deterministic PoC

---

## Pricing (how customers pay)

This repo is **OSS**. You can clone and run it for free.

Customers pay for the **managed service**: operation + customization + SLA + reporting + integrations.

**Start now (Growth $499/mo):** [Checkout on Stripe](https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00)

### Managed Retainer Tiers (recommended)
| Tier | Best for | Includes | Price (USD) |
|---|---|---|---:|
| **CI Basic** | teams that just want a gate | nightly/weekly rotation, triage + alerts, artifacts | **$500/mo** ([Buy Growth $499/mo](https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00)) |
| **Regression Pro** | teams shipping frequently | + dashboard trend, score reporting, weekly digest, tuning pendings | **$2,500/mo** |
| **Bounty Enterprise** | high TVL / high stakes | + custom invariants, incident response window, white-label reports, priority support | **$8,000/mo** |
| **Custom** | enterprise/compliance | dedicated infra/RPC, SSO portal, ticketing integrations | **$15,000+/mo** |

**Typical setup fee (optional):** $3k-$15k depending on custom invariants and protocol complexity.  
**Optional success fee:** negotiated for confirmed paid bounties (if desired).

**How to start paid service:** open an issue or email the contact in `SECURITY.md` (or add your sales email here).

---

## How it works (high level)

1. **Fork-based execution** on historical blocks (archive RPC required)
2. **Invariant suite / exploit search** runs deterministically
3. **Triage** generates:
   - severity (Critical/High/Medium)
   - stable identity key + content hash (dedupe-safe)
   - USD impact with recorded ETH price and source
4. **Packaging** turns proofs into submission-ready bundles
5. **Dashboard** summarizes runs and scores over time
6. **(Managed mode)** schedules and serves dashboards for multiple clients

---

## Quickstart (OSS, 5 minutes)

### One-command bounty hunt (CI-style)
```bash
npm ci
cp .env.example .env
npm run bounty-rotation
```

What this runs:
- extended exploit-search suite
- triage output: `outputs/triage/triage-result.json`
- dashboard output: `outputs/metrics/dashboard.html`

---

## Demo Mode (no live finding required)

Use this to onboard or record a demo without claiming a real exploit:

```bash
npm run demo:proof -- --price 2172.24
```

Outputs are isolated (won’t pollute real proof paths):
- `outputs/demo/proofs/demo-proof.json`
- `outputs/demo/proof-packages/.../immunefi-report.md`

**Truth-in-reporting note:** use “bounty candidate” unless a human-reviewed submission is ready.

---

## Managed/Hosted Mode (for customers)

Run a client scan once:
```bash
npm run managed:run -- --client example --once --price 3400
```

Run scheduler:
```bash
npm run managed:scheduler -- --client all
```

Serve dashboards (token auth):
```bash
npm run managed:serve
```

Details: `docs/managed-service.md`

---

## Supported environments

- Node.js **20.x**
- GitHub Actions `ubuntu-latest`
- Windows PowerShell (local commands and repro scripts)

### RPC expectations
- **Archive RPC required** for deterministic historical fork reads
- `eth_blockNumber` required for preflight checks
- Runs are read-heavy; don’t use endpoints not intended for archive access

---

## Common failures (and fixes)

- **RPC 429 / timeouts:** switch provider or raise tier; retry with backoff
- **Not an archive node:** use an archive endpoint in `.env`
- **Windows log encoding:** prefer UTF-8 when piping logs

---

## Vault audit / consulting bundle (optional path)

This repo also supports a “client deliverable bundle” workflow (deterministic evidence bundles, reports, manifests):

Example:
```bash
npm run deliverable -- 0x489ee077994B6658eAfA855C308275EAd8097C4A --block 200000000 --rpc https://arb1.arbitrum.io/rpc --client RigoCrypto --engagement whitelist-review
```

See full details in the repo docs (and `docs/sales-launch-kit.md` if present).  
**Note:** This is not a substitute for a full manual smart contract audit; AI output is advisory and must be human-reviewed.

---

## Why this is different
- Deterministic fork pinning (reproducible evidence)
- Automatic proof packaging + report generation
- Triage contract is versioned (`schema_version`)
- Managed mode supports multi-client operation without putting paywalls in OSS

---

## Contact / Getting a quote
- Security disclosures: `SECURITY.md`
- For managed service / retainer: open an issue tagged `managed-service` or add your email here.

---

## Customer FAQ

### Can my team run this ourselves?
Yes. The repository is OSS and can be run internally with your own archive RPC and CI setup. Many teams start self-hosted, then move to managed mode when they want SLA-backed operations.

### What access do you need for managed service?
At minimum, archive RPC endpoints and preferred alert channels (Slack/email). You keep custody of your contracts and keys. Managed mode focuses on read-heavy monitoring, deterministic evidence generation, and reporting.

### Where are artifacts stored?
Artifacts are written per run under `outputs/managed/<client>/<date>/<runId>/` and include logs, triage output, dashboard files, and proof/report packages when present.

### How do you handle NDAs and private findings?
Findings and artifacts can be handled under NDA terms with private delivery paths. Public disclosure is never assumed; disclosure timing and channels are coordinated with your team.

### Is this a replacement for a full manual audit?
No. This system is built for deterministic monitoring, regression detection, and proof packaging. It complements (but does not replace) manual review by experienced auditors.

### How quickly can we onboard?
Basic onboarding is typically same-day for teams with working archive RPC access. Custom invariants, white-label reporting, and enterprise integrations may require additional setup time.



