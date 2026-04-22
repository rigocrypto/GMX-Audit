# PRD: GMX Audit Control Center

## 1. Product Definition

### 1.1 Summary
GMX Audit Control Center is a deterministic, dashboard-first Web3 security suite for invariant hunting, continuous regression monitoring, explainable triage, and submission-ready proof packaging.

### 1.2 Problem
Protocol teams and hunters lose time moving between scripts, logs, spreadsheets, and ad hoc report templates. Findings are hard to replay, triage is inconsistent, and security posture is difficult to track over time.

### 1.3 Why now
- Existing repo capabilities already provide deterministic execution, triage, packaging, and managed scheduling.
- Teams need continuous security operations, not one-off reports.
- Bounty/disclosure workflows reward reproducible, evidence-backed reports.

### 1.4 Value proposition
- Deterministic and reproducible security runs on historical state.
- Explainable triage with schema versioning and dedupe-safe identities.
- One-path generation of proof artifacts and report packages.
- Dashboard visibility for security posture trend monitoring.
- OSS-first with optional managed operations.

## 2. Scope and priorities

### 2.1 V1 scope (MVP)
- Control Center overview dashboard generated as static HTML.
- Findings explorer and finding detail pages.
- Proof package detail pages with artifact links.
- Security score snapshots and trend chart.
- Managed-mode visibility for run status and client scoping.

### 2.2 Non-goals (V1)
- Real-time streaming monitoring.
- Full multi-tenant hosted SaaS portal.
- Autonomous remediation or auto-fix actions.
- Replacing manual auditor judgment.

### 2.3 Priority labels

| Area | Priority | Notes |
|---|---|---|
| README and docs rebrand | P0 | Public storefront and contributor alignment |
| Schema contracts for core entities | P0 | Required for stable ingestion and CI validation |
| Static overview dashboard | P0 | First visible product surface |
| Findings explorer and proof views | P0 | Core triage and package workflow |
| Score explainability panel | P1 | Improves trust and adoption |
| Alert digest templates | P1 | Operations maturity |
| Hosted API mode | P2 | Future expansion |
| Full auth portal | P2 | Future expansion |

## 3. Personas and success criteria

### 3.1 Protocol security lead
Needs continuous regression signal, clear impact framing, and reproducible evidence.
Success: faster triage and escalation with deterministic artifacts.

### 3.2 Hunter/auditor
Needs rapid route from candidate to submission-quality package.
Success: proof packaging in minutes with replayable commands.

### 3.3 Enterprise security manager
Needs trend visibility and report-ready outputs for governance.
Success: stable score trends and predictable run reliability.

### 3.4 Managed-service client
Needs low-overhead operation and controlled artifact access.
Success: token-protected dashboards and client-scoped delivery.

## 4. Functional requirements by module

## 4.1 Control Center dashboard (P0)
Inputs:
- outputs/triage/triage-result.json
- SQLite run history
- score snapshots

Outputs:
- outputs/metrics/dashboard.html
- linked static detail pages

Required capabilities:
- run counts, severity mix, score-over-time, top finding rows
- filters by chain/date/severity/status
- links to finding and proof pages

Validation/edge cases:
- empty history state
- partial run state
- missing triage file warning

## 4.2 Findings explorer (P0)
Inputs:
- normalized finding records from triage output

Outputs:
- static finding index and per-finding pages

Required capabilities:
- sort/filter by severity, status, impact, protocol, chain
- show stable identity key and content hash
- cross-link to run and proof package

Validation/edge cases:
- duplicate identities across runs
- missing impact values

## 4.3 Proof package viewer (P0)
Inputs:
- proof.json, summary.json, repro.sh, repro.ps1, immunefi-report.md
- artifact manifest

Outputs:
- static proof detail page and artifact links

Required capabilities:
- render package metadata and file links
- show both Bash and PowerShell repro commands
- show generation timestamp and schema version

Validation/edge cases:
- missing artifact file
- partial package generation

## 4.4 Security score engine (P0 for snapshot, P1 for explainability)
Inputs:
- finding severity distribution
- run reliability metrics

Outputs:
- score snapshot JSON
- trend dataset for charts

Required capabilities:
- deterministic calculation
- score version stamp

Validation/edge cases:
- no-finding runs
- schema migrations across versions

## 4.5 Managed ops (P0 baseline)
Inputs:
- managed client config
- scheduler state

Outputs:
- client-scoped run artifacts under outputs/managed

Required capabilities:
- schedule execution, retries, overlap locks, retention pruning
- token-protected serving path

Validation/edge cases:
- lock collisions
- expired dashboard token
- client path isolation checks

## 5. Data contracts

Core entities (schema-versioned):
- Run
- Finding
- ProofPackage
- SeverityClassification
- SecurityScoreSnapshot
- Client
- AlertEvent
- ArtifactManifest

Required fields (minimum):
- schema_version on every entity
- stable IDs and timestamps
- run_id foreign key linkage
- content_hash for findings and artifact files

## 6. Technical requirements

- Node.js 20.x compatibility
- GitHub Actions compatibility
- archive RPC required for historical forks
- static-first output with no CDN dependency
- SQLite-backed history
- schema versioning and compatibility checks
- deterministic output ordering and pathing
- token-protected managed dashboards

## 7. Success metrics

- Median time from run completion to triage result
- Median time from finding to proof package
- Run success rate and retry recovery rate
- Dashboard usage and finding-detail clickthrough
- OSS to managed conversion rate

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Security score overinterpreted | Add score explanation panel and disclaimer |
| Severity over-automation | Keep human-review gating for submission decisions |
| Stale artifact links | Manifest integrity checks in CI |
| Archive RPC instability | Preflight checks and retry policy |
| Dashboard complexity creep | Strict V1 IA and phased additions |
| Managed client data leakage | Client-scoped path and token isolation |

## 9. Open questions

- Should score weighting be fixed or configurable per client?
- What is default retention by managed tier?
- Which finding lifecycle states should be user-editable in static mode?
- Should alerting be in-core or adapter-only in V1?

## 10. Release recommendation

### V1 (MVP)
- README rebrand
- schema contracts
- static overview dashboard
- findings/proof pages
- managed baseline visibility

### V1.1
- score explainability panel
- run-to-run finding deltas
- weekly digest templates

### V2
- optional API mode
- hosted multi-tenant portal
- queue-based orchestration extensions
