# gmx-audit

Deterministic GMX security harness for **invariant hunting**, **continuous regression**, and **Immunefi-ready proof packaging** (plus a managed service option for protocol teams).

[![Bounty Rotation CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml)
[![Audit Batch CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml)
[![Secret Scan](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml)

**Docs**
- Continuous operations: `docs/continuous-security.md`
- Managed service (hosted/retainer): `docs/managed-service.md`
- Security policy: `SECURITY.md`
- Contributing: `CONTRIBUTING.md`
- License: MIT (`LICENSE`)

---

## Who this is for

### Protocol teams (GMX forks / perpetuals / DeFi)
You want **continuous security monitoring** you can explain to non-security stakeholders:
- nightly regression scans
- “Security Score” trend
- alerts when a real economic invariant breaks
- reproducible evidence bundles

### Hunters / auditors
You want:
- deterministic fork-based runs over historical blocks
- automated **triage + severity**
- **proof package** and **Immunefi-ready report** in minutes (demo or real)

### Enterprise security & ops
You want:
- repeatable runs, stored artifacts, and audit trail
- minimal manual effort
- clear outputs to drive escalation

---

## What you get (customer value)

### 1) Deterministic proof -> Immunefi-ready package
When a run yields a **bounty candidate**, you get a reproducible bundle:
- `proof.json` + `summary.json`
- `repro.sh` + `repro.ps1` (exact commands)
- `immunefi-report.md` (ready to submit)
- economic impact shown with **signed USD** (`+$` attacker gain / `-$` pool loss) and **ETH price basis**

### 2) Continuous regression + “Security Score”
For ongoing monitoring:
- dashboard HTML (no CDN) + SQLite history
- trend chart over recent runs
- filters (chain, blocks, proofs-only, failures-only)
- score formula is deterministic and client-friendly

### 3) CI automation (multi-chain)
GitHub Actions workflows support:
- scheduled runs
- triage output contract (`schema_version`)
- safe dedupe behavior (content hash vs identity)
- secret scanning on PRs

### 4) Managed/Hosted Service Mode (Option B)
If you don’t want to operate it:
- multi-client config
- scheduled execution
- hosted token-protected dashboards
- alerts + artifacts per client run
- retention pruning + retries + overlap locks

---

## Pricing (how customers pay)

This repo is **OSS**. You can clone and run it for free.

Customers pay for the **managed service**: operation + customization + SLA + reporting + integrations.

### Managed Retainer Tiers (recommended)
| Tier | Best for | Includes | Price (USD) |
|---|---|---|---:|
| **CI Basic** | teams that just want a gate | nightly/weekly rotation, triage + alerts, artifacts | **$500/mo** |
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

### Optional: Add a “Customer FAQ” section?
If you want, I can add a short FAQ (e.g., “Can my team run it ourselves?”, “What access do you need?”, “Where are artifacts stored?”, “How do you handle NDA?”) and tailor the pricing copy to your exact offer.
