# Continuous Security - gmx-audit

Operational guide for the invariant monitoring pipeline.

## Table of Contents

1. Running Locally
1. Reading the Dashboard
1. Packaging a Proof
1. GitHub Actions Jobs
1. Adding a New Client Config
1. Secrets Required
1. Pricing Tiers

## Running Locally

### Prerequisites

- Node.js >= 18
- PowerShell 7+ for `scripts/rotateAndSearch.ps1`
- Archive RPC endpoint per chain

### Setup

```bash
npm ci
cp .env.example .env
# Edit .env with your RPC URLs and optional pricing flags
```

### Single chain exploit search

```powershell
$env:GMX_CHAIN = "arbitrum"
$env:ARBITRUM_RPC_URL = "https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
npm run test:gmx-exploit-search:extended
```

```powershell
$env:GMX_CHAIN = "avalanche"
$env:AVALANCHE_RPC_URL = "https://avalanche.drpc.org"
$env:GMX_ALLOW_AVA_ORACLE_EXECUTE = "1"
npm run test:gmx-exploit-search:ava
```

### Rotation helper

```powershell
powershell -ExecutionPolicy Bypass -File scripts/rotateAndSearch.ps1
```

### Full invariant suite

```bash
npm run test:gmx-invariants:full
```

### Extended exploit search

```bash
npm run test:gmx-exploit-search:extended
```

## Reading the Dashboard

Generate after runs:

```bash
npm run dashboard -- --db outputs/metrics/results.db --out outputs/metrics/dashboard.html
```

Open `outputs/metrics/dashboard.html` in a browser.

### KPI cards

- Security Score (7-run avg): 90-100 healthy, 70-89 degraded, below 70 critical
- Total Runs: all runs persisted in SQLite
- Proofs Generated: number of `exploit-proofs/*.json` matched to runs
- Avg Duration: mean run time in seconds

### Score formula

```text
score = 100 - (failing * 30) - (proof_count * 50) - (unexplained_pending * 5)
score = max(0, score)
```

### Row colors

- Red row: proof detected for that run
- Amber row: failing tests, no proof
- No highlight: clean run

### Filters

- Chain dropdown
- Block search
- Proofs only
- Failures only

## Packaging a Proof

When a proof is generated in `exploit-proofs/`:

```bash
npm run proof:package -- --file exploit-proofs/YOUR-PROOF.json --outDir proof-packages --price 3400
```

Standalone Immunefi report:

```bash
npm run generate-immunefi -- --file exploit-proofs/YOUR-PROOF.json --out report.md --price 3400
```

### Package contents

- proof.json: original proof payload
- summary.json: parsed metadata, severity, fingerprint hash
- env.txt: environment snapshot for reproduction
- repro.sh: bash repro script
- repro.ps1: PowerShell repro script
- immunefi-report.md: submission-ready markdown

### Validate a proof

```bash
npm run proof:validate -- --file exploit-proofs/YOUR-PROOF.json
```

Exit codes:

- 0 valid
- 2 bad input
- 3 schema validation failure

## GitHub Actions Jobs

Workflow: `.github/workflows/bounty-rotation.yml`

Schedule: daily at 02:00 UTC.

### Job graph

```text
compile
  |- rotate (matrix: arbitrum, avalanche)
      |- triage
          |- alert (only if high/critical)
          |- auto-package (only if proofs > 0)
          |- dashboard (always)
```

### Job descriptions

- compile: `npm ci`, `hardhat compile`, cache deps/artifacts
- rotate: run exploit search by chain matrix and upload logs/proofs
- triage: scan `exploit-proofs/*.json`, classify severity, publish outputs
- alert: create GitHub issue and optional Slack alert for high/critical findings
- auto-package: build up to 5 Immunefi-ready proof packages when proofs are found
- dashboard: generate `dashboard.html` and `results.db` artifact

### Manual trigger

Actions -> Bounty Rotation -> Run workflow inputs:

- chain: arbitrum, avalanche, all
- notify: true or false

### Artifacts

- rotation-log-arbitrum (30d)
- rotation-log-avalanche (30d)
- exploit-proofs-arbitrum (90d)
- exploit-proofs-avalanche (90d)
- triage-result (30d)
- security-dashboard (90d)

### Proof Lifecycle Labels

- status:new: newly detected, not submitted yet
- status:submitted: submitted to Immunefi
- status:triaging: under Immunefi review
- status:resolved: resolved or paid
- status:wont-fix: invalid/rejected/accepted risk

If a proof is re-detected and an issue already has `status:submitted`, `status:resolved`, or `status:wont-fix`, CI comments with a warning to verify if it still applies.

## Adding a New Client Config

1. Copy template from `config/pricing.ts` into a client config file.
1. Generate proposal:

```bash
npm run pricing:proposal -- --client "Protocol Name" --tier "Regression Pro" --format html --out outputs/proposals/proposal-protocol.html
```

1. Add chain RPC secrets in repository settings.

## Secrets Required

- `ARBITRUM_RPC_URL` (required)
- `AVALANCHE_RPC_URL` (required)
- `SLACK_WEBHOOK_URL` (optional)

## Pricing Tiers

Use `npm run pricing:proposal` for client-ready proposals.

- OSS Free: $0
- CI Basic: $500/mo
- Regression Pro: $2,500/mo
- Bounty Enterprise: $8,000/mo
- Custom: $15,000+/mo
