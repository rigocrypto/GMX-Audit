# GMX Audit Control Center

Continuous security. Real economic impact. Submission ready.

GMX Audit Control Center is a deterministic security suite for Web3 protocols focused on invariant hunting, continuous regression monitoring, explainable triage, and reproducible proof packaging.

[![Bounty Rotation](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml)
[![Audit Batch CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml)
[![Secret Scan](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/secret-scan.yml)

**Managed plan (Growth $499/mo):** [Checkout on Stripe](https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00)

---

## What It Is

GMX Audit Control Center combines five product modules:

1. **Execution Engine**
   - Deterministic fork execution on historical chain state.
2. **Triage Engine**
   - Severity classification with schema versioning and dedupe-safe identity/content hash handling.
3. **Proof Packaging**
   - Reproducible artifacts and submission-ready report bundles.
4. **Security Score**
   - Trend-oriented posture tracking across runs.
5. **Managed Ops**
   - Multi-client scheduling, retention, retries, overlap locks, and token-protected dashboards.

---

## Who This Is For

### Protocol teams (perps / DeFi / GMX forks)

You need continuous, explainable monitoring:

- Regression scans on a schedule
- Trackable security posture over time
- Escalation-ready evidence bundles
- Clear outputs for engineering and incident response

### Hunters and auditors

You want a faster signal-to-submission loop:

- Deterministic historical replay
- Triage and severity support
- Proof packaging with reproducible commands
- Immunefi-ready reporting artifacts

### Enterprise security and ops

You care about operational reliability:

- Repeatable runs with retained artifacts
- Low-overhead automation
- Structured outputs for reporting and governance

---

## Core Capabilities

- Deterministic and reproducible historical fork execution
- Continuous regression and exploit-search workflows
- Versioned triage outputs in `outputs/triage/triage-result.json`
- Static dashboard output in `outputs/metrics/dashboard.html`
- Proof artifacts: `proof.json`, `summary.json`, `repro.sh`, `repro.ps1`, `immunefi-report.md`
- SQLite-backed run history and trends
- CI-native automation with secret scanning and schema versioning
- Managed multi-client operations with retention/retry/lock controls

---

## Control Center Modules

1. **Overview Dashboard**
   - Security score, run volume, severity mix, trend snapshots
2. **Findings Explorer**
   - Severity-first queue with chain/protocol impact context
3. **Proof Package Viewer**
   - Artifact manifest and repro workflow links
4. **Run History Explorer**
   - Historical run timeline and status trail
5. **Managed Operations Surface**
   - Client-scoped scheduling and service controls

---

## How It Works

1. Run deterministic fork execution at historical blocks (archive RPC required).
2. Execute invariant suites and exploit-search checks.
3. Generate triage with severity, stable identity key, content hash, and impact framing.
4. Package reproducible proof artifacts and report templates.
5. Render static dashboard analytics for continuous monitoring.
6. Optionally operate in managed mode for multi-client scheduling and delivery.

---

## What You Get When a Proof Is Found

Each valid candidate can include:

- `proof.json`
- `summary.json`
- `repro.sh`
- `repro.ps1`
- `immunefi-report.md`

The package is designed for deterministic replay and submission workflows.

---

## Dashboard and Analytics

- Static HTML output (no CDN dependency)
- SQLite-backed trend history
- Severity distribution and score-over-time charts
- Filters for chain, block window, and finding state
- Artifact-linked detail pages for triage and proof review

## Dashboard Preview

![Control Center Overview](https://raw.githubusercontent.com/rigocrypto/bounty-rotation-harness/main/examples/sample-dashboard/screenshot.png)

[View sample dashboard ->](https://htmlpreview.github.io/?https://raw.githubusercontent.com/rigocrypto/bounty-rotation-harness/main/examples/sample-dashboard/overview.html)

> Sample generated from a representative run. Actual outputs reflect
> your protocol targets and run configuration.

---

## Managed Service

Managed mode is for teams that want continuous operation without owning pipeline overhead.

Includes:

- Multi-client configuration
- Scheduled execution
- Token-protected dashboards
- Alerts and artifact delivery per run
- Retention pruning, retries, overlap locks

Details: [Managed service docs](docs/managed-service.md)

### Billing Model

- OSS workflows in this repository stay free and ungated.
- Billing applies only to hosted managed-service capabilities.
- Stripe handles checkout, subscriptions, invoices, retries, and customer billing portal actions.
- Webhooks are authoritative for billing state changes; browser redirects are not used as source of truth.

Handled Stripe events:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Architecture and operations details:

- [Stripe integration architecture](docs/stripe-integration.md)
- [Billing runbook](docs/billing-runbook.md)

---

## Quickstart (OSS)

```bash
npm ci
cp .env.example .env
npm run bounty-rotation
```

Outputs:

- `outputs/triage/triage-result.json`
- `outputs/metrics/dashboard.html`

---

## Demo Mode

Run a non-production demo package:

```bash
npm run demo:proof -- --price 2172.24
```

Demo outputs are isolated and do not pollute primary proof paths.

---

## Managed Mode

Run one client scan:

```bash
npm run managed:run -- --client example --once --price 3400
```

Run scheduler:

```bash
npm run managed:scheduler -- --client all
```

Serve token-protected dashboards:

```bash
npm run managed:serve
```

---

## Supported Environments

- Node.js **20.x**
- GitHub Actions `ubuntu-latest`
- Windows PowerShell (local command and repro support)

### RPC requirements

- Archive RPC is required for deterministic historical reads
- `eth_blockNumber` is required for preflight checks
- Runs are read-heavy; use endpoints intended for archive access

---

## Real-World Coverage

This suite has been exercised on live DeFi protocol patterns under real market conditions.

### Moonwell (Compound v2 fork on Base)

Coverage includes:

- Comptroller risk checks (liquidity and shortfall)
- Oracle integration behavior
- Liquidation flows and seize math
- Stale price edge cases

Example class:

- Oracle freshness validation gaps that allow overborrowing and persistent insolvency

### Legion (sealed-bid auction)

Coverage includes:

- Settlement and withdrawal solvency consistency
- Refund liability vs withdrawable accounting
- Claim reachability under valid Merkle proofs
- Lifecycle reachability across publish, withdraw, and refund phases

Example class:

- Capital conservation violations causing contradictory accepted state and unclaimable refunds

See `outputs/` for reproducible artifacts and examples.

---

## Pricing

This repository is OSS and free to run.

Customers pay for managed service operation, customization, and reporting.

**Managed plan (Growth $499/mo):** [Checkout on Stripe](https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00)

| Tier | Best for | Includes | Price (USD) |
|---|---|---|---:|
| **CI Basic** | teams that want a reliable gate | nightly or weekly rotation, triage, alerts, artifacts | **$500/mo** |
| **Regression Pro** | teams shipping frequently | + score trend reporting, weekly digest, tuning support | **$2,500/mo** |
| **Bounty Enterprise** | high TVL protocols | + custom invariants, incident response window, white-label reports | **$8,000/mo** |
| **Custom** | enterprise/compliance | dedicated infra, SSO portal, ticketing integrations | **$15,000+/mo** |

Typical setup fee (optional): $3k to $15k depending on custom scope.

---

## Why This Is Different

- Deterministic and reproducible outputs by default
- Explainable triage with schema-versioned contracts
- Submission-ready proof packaging built into the pipeline
- Static-first architecture with low operational overhead
- OSS foundation plus managed path without paywalling core workflows

---

## FAQ

### Can my team run this ourselves?

Yes. The repository is OSS and can run with your own archive RPC and CI setup.

### Is this a replacement for manual smart contract audits?

No. It complements manual review with deterministic monitoring, regression detection, and proof packaging.

### Where are managed artifacts stored?

Managed outputs are written per run under `outputs/managed/<client>/<date>/<runId>/`.

### How quickly can we onboard managed mode?

Basic onboarding is typically same-day when archive RPC access is ready.

---

## Docs

- [Continuous operations](docs/continuous-security.md)
- [Managed service](docs/managed-service.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)

---

## Security and Contact

- Security disclosures: [SECURITY.md](SECURITY.md)
- Managed service inquiries: open an issue tagged `managed-service` or use the security contact path

---

> Advisory note: AI-assisted outputs are advisory and require human review. This suite does not guarantee exploit detection and is not a substitute for a full manual audit.
