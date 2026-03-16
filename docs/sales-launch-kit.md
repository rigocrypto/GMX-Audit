# Rigo-Crypto Vault Auditor Launch Kit

One-command, block-pinned GMX v1/v2 evidence bundles for collateral exposure, oracle health, security appendices, and AI-assisted triage.

Quick assets:

- One-page handout: [docs/client-handout.md](client-handout.md)
- Demo link pack: [docs/demo/README.md](demo/README.md)
- Ops runbook: [docs/ops-runbook.md](ops-runbook.md)
- Screenshot placeholders: [docs/assets/sample-report-exec.png](assets/sample-report-exec.png), [docs/assets/sample-report-markets.png](assets/sample-report-markets.png)

## Executive One-Page Offer

### Offer In One Screen

- We deliver a block-pinned GMX v1/v2 evidence bundle that combines exposure analysis, oracle-health checks, security appendices, and optional AI-assisted triage.
- This matters because protocol teams can move from manual investigation to decision-ready evidence in a single package.
- Price: starts at $4,500 per chain.
- Turnaround: 24 to 72 hours (rush available).

### What We Need From The Client

- Target chain and vault or deployment address.
- Preferred block mode (latest or pinned block number).
- Archive RPC availability (yes or no).

CTA: Email or DM with the intake form details to receive quote, ETA, and delivery plan.

Messaging guardrail: describe outcomes as automated risk flags and deterministic evidence, not exploit confirmation.

### Pricing And Turnaround Guarantees

| Plan | Turnaround | Price | Guarantee | Constraints |
| --- | --- | ---: | --- | --- |
| Standard | 48h target | $4,500 per chain | 1 revision included for updated address or block inputs | Public RPC supported; pinned historical completeness may be partial |
| Rush | 24h target | +50% | Priority queue and expedited handoff | Subject to client response times and RPC availability |
| Pinned Historical Complete | Follows selected plan | Included when archive available | Security section delivered without partial-history caveat | Requires archive-capable RPC endpoint |

## Positioning

### What This Is

- A deterministic GMX vault review workflow for v1 and v2.
- A client-ready bundle generator for reports, manifests, machine-readable exports, and evidence packaging.
- A fast-turnaround consulting product for governance reviews, collateral screening, oracle checks, and upgrade diffs.

### What This Is Not

- Not a full manual smart contract audit.
- Not a guarantee that no vulnerabilities exist.
- Not a complete economic or game-theoretic review of GMX.
- Not a replacement for human validation of automated or AI-generated findings.

### Core Promise

Deliver a reproducible ZIP containing the state snapshot, exposure analysis, oracle and pricing checks, static-analysis appendices, and executive-ready reporting in 24 to 72 hours.

## Proof

### Validated Sample Runs

| Chain | Mode | Block | Markets | Collateral Tokens | Metadata Failures | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Arbitrum | v2 | 441411191 | 129 | 24 | 0 | Public-RPC run with config-backed token metadata overrides |
| Avalanche | v2 | 80289924 | 20 | 10 | 0 | Multi-chain parity confirmed with config-backed collateral metadata |

Market counts reflect the deployed GMX v2 market set at the sampled block on each chain, so Arbitrum and Avalanche totals are expected to differ.

## Sample Findings

### Finding Card 1

- Finding: Missing index-token feed coverage on multiple markets (HIGH).
- Impact: Price risk and liquidation assumptions can be misestimated for affected markets.
- Evidence: Risk summary and market table rows with missing index feed flags.
- Recommendation: Add or validate feed mapping for index tokens before governance expansion.

### Finding Card 2

- Finding: Concentration exceeds threshold on top collateral exposure (MEDIUM).
- Impact: Collateral imbalance increases sensitivity to single-asset volatility.
- Evidence: Exposure table and concentration percentage in report summary.
- Recommendation: Apply concentration guardrails and review listing caps.

### Finding Card 3

- Finding: Stale price feed above policy window (HIGH, when observed).
- Impact: Decisions can be based on outdated price inputs.
- Evidence: Staleness flag and feed update timestamp in token rows.
- Recommendation: Enforce staleness checks and fallback policy before execution paths.

### Finding Card 4

- Finding: Historical security output partial due to non-archive RPC (INFO).
- Impact: Historical bytecode and deep historical checks may be incomplete for pinned blocks.
- Evidence: Security section banner and archive notice in report output.
- Recommendation: Require archive-grade RPC for pinned historical security completeness.

## Severity Interpretation

- Severity labels in this document represent operational, oracle, and configuration risk, not a confirmed exploit severity rating.
- HIGH: Missing index-token feed, stale oracle beyond policy threshold, or equivalent configuration gap with direct pricing impact.
- MEDIUM: Missing long or short feed, zero-liquidity market, concentration warning, or equivalent exposure risk.
- LOW or INFO: Metadata fallback usage, partial historical-security notice, or advisory context requiring analyst follow-up.

## Mini Case Study (Internal Pattern)

- Context: Multi-chain collateral review before listing changes.
- Signal detected: Missing index-feed coverage and elevated concentration on top collateral.
- Action taken: Listing and parameter decision deferred pending feed-map and risk-parameter updates.
- Outcome: Governance review moved forward with deterministic evidence and explicit remediation tasks.

## Methodology

- Data sources: on-chain contract reads at block tag, Chainlink feed reads, and chain-config metadata overrides with provenance tracking.
- Tooling: normalized outputs from security tooling plus schema-checked AI triage artifacts.
- Determinism: bundle manifest includes block hash, file hash records, and evidence exports for reproducibility.

## Limitations

- USD exposure calculations depend on available and mapped Chainlink feed coverage.
- Public RPC endpoints may produce partial historical security artifacts for pinned-block requests.
- AI triage output is advisory only and must be validated by a human reviewer.
- This package is not a full manual smart contract audit.

### Commercial Value

| Capability | Status | Buyer Outcome | Typical Hours Avoided | Commercial Framing |
| --- | --- | --- | ---: | --- |
| GMX v1 vault snapshot | Ready | Whitelists, balances, token inventory | 4-6 | Included in base chain review |
| GMX v2 market inventory | Ready | Market map, collateral inventory, missing-feed detection | 8-12 | Base deliverable |
| Risk scoring and USD exposure | Ready | Concentration and stale/missing oracle flags | 4-6 | Base deliverable |
| Metadata overrides on public RPC | Ready | Stable reports without symbol/name failures | 2-4 | Included |
| Bundle manifest and ZIP packaging | Ready | Shareable evidence package with hashes | 1-2 | Included |
| AI triage and suggested invariants | Ready | Advisory hypotheses for reviewer follow-up | 4-8 | Add-on |
| Multi-chain parity | Ready | Same workflow on Arbitrum and Avalanche | 6+ per chain | Multi-chain upsell |
| Upgrade or governance diff | Ready to package | Before/after risk comparison across two blocks | 6-10 | Premium add-on |

Estimated ROI: 20 to 40 analyst hours avoided per engagement. At $500 per hour, that is roughly $10k to $20k in review effort compressed into a deterministic package.

## Deliverable Spec

### Client Receives

- `report.html` for executive review.
- `report.md` for Notion, Obsidian, or Git workflows.
- `audit.csv` for spreadsheet filtering and handoff.
- `audit.json` for machine-readable evidence and downstream automation.
- `manifest.json` with bundle file hashes, block metadata, and tooling references.
- `security/run.json` and normalized security outputs when security mode is enabled.
- `ai_findings.normalized.json` and invariant suggestions when AI mode is enabled.
- `bundle.zip` for a single deliverable artifact.
- Versioned bundle folder naming tied to client, engagement, chain, vault, block, and date.

### Acceptance Criteria

- Bundle includes block number and block hash.
- Token rows expose metadata provenance via `metadataSource`.
- Partial historical-security output is labeled when the RPC is not archive-capable.
- The report clearly separates deterministic evidence from advisory AI comments.

## Archive RPC Policy

- Default mode: latest-block runs can execute on public RPC for standard exposure and risk reporting.
- Pinned historical completeness: if a client requires full historical security completeness at a pinned block, archive-capable RPC is required.
- Turnaround guardrail: if archive RPC is unavailable for historical requirements, delivery is marked partial with explicit notices.

## Intake To Delivery Timeline

```text
1) Intake
   chain + address + block mode + RPC policy
               |
               v
2) Run + QA
   execute deliverable, validate report tables, manifest, and caveats
               |
               v
3) Delivery
   send ZIP bundle, summary email, optional debrief call
               |
               v
4) Follow-On
   optional diff run, rerun, or retainer cadence
```

## Pricing

| Package | Scope | Deliverables | Price |
| --- | --- | --- | ---: |
| Single Chain | 1 chain, pinned block | Bundle, report set, evidence exports | $4,500 |
| Multi-Chain Bundle | Arbitrum + Avalanche baseline | Two-chain bundle and summary | $8,500 |
| AI Add-On | 1 chain | AI triage plus suggested invariants | +$1,500 |
| Multi-Chain | 2 chains | Second chain parity bundle | +$1,500 per chain |
| Upgrade Diff | 2 pinned blocks | Delta report and change summary | +$3,500 |
| Rush | <24h | Prioritized turnaround | +50% |

### Scope Add-Ons Menu

| Add-On | Description | Price |
| --- | --- | ---: |
| Additional Chain | Extend same scope to one more chain | +$1,500 |
| Additional Address Batch | Extra vault or deployment set in same engagement | +$1,500 |
| AI Triage Package | AI findings normalization plus invariant suggestions | +$1,500 |
| Upgrade Diff Package | Pre/post block delta analysis | +$3,500 |
| Foundry Invariant Harness | Initial invariant harness from triage recommendations | +$4,500 |
| Rush SLA | Prioritized queue and expedited handoff | +50% |

Commercial terms:

- One revision included for updated block or address inputs.
- Archive RPC can be supplied by client or sourced as a pass-through cost.
- AI output is advisory and must be human-reviewed before escalation.

## Competitive Benchmark

| Category | Typical Tools | What They Usually Miss | What Rigo-Crypto Delivers |
| --- | --- | --- | --- |
| Static analysis | Slither, Mythril | No protocol-level exposure or oracle context | Exposure report plus scan appendix |
| Fuzzing | Foundry, Echidna | Requires custom harnesses and engineering time | Ready-made evidence bundle and AI-suggested invariants |
| Monitoring and ops | Tenderly, Defender, Forta | Operational telemetry, not a block-pinned audit packet | Deterministic client deliverable with hashes and exports |

## Demo Command

Use the same command you will run for a paying client:

```powershell
npm run deliverable -- --mode v2 --rpc https://arb1.arbitrum.io/rpc --block latest --client DemoProtocol --engagement collateral-review-q1-2024 --zip --usd --risk --ai
```

### Standard Engagement Command Template

```bash
npm run deliverable -- --mode auto --rpc <RPC> --block <BLOCK> --client <CLIENT> --engagement <ENGAGEMENT> --zip --usd --risk --report-html --report-md --security --ai
```

Recommended gate policy:

- Public RPC: use `--gate-mode warn` to avoid false hard-fails on partial historical data.
- Archive RPC: use stricter gate settings when full historical completeness is required.

Public proof caution:

- Prefer screenshots plus redacted summary for public marketing.
- Publish full ZIP publicly only after explicit redaction review.

Expected demo outputs:

- Latest-chain market and collateral snapshot.
- Risk summary with missing feeds, zero-liquidity flags, and concentration data.
- Security appendix.
- AI triage section with gate JSON.
- Shareable ZIP for email or deal-room delivery.

## Try Before Buy

Free demo scope:

- One chain.
- One run.
- Public RPC.
- Latest block.
- No historical-completeness guarantee.

Use the free demo to validate report format and evidence structure before a paid engagement.

## Screenshot Pack

- Executive summary image: [docs/assets/sample-report-exec.png](assets/sample-report-exec.png)
- Markets risk table image: [docs/assets/sample-report-markets.png](assets/sample-report-markets.png)

Replace placeholder images with real captures from the latest demo report before external outreach.

Capture workflow:

```powershell
npm run capture:setup
npm run capture:screens -- --bundle outputs/bundles/<bundle-folder> --out docs/assets
```

Single-command refresh workflow:

```powershell
npm run demo:refresh
```

## Sales Copy

### Website Hero

Headline: Block-Pinned GMX Risk Bundles In 24 To 72 Hours

Subheadline: Rigo-Crypto packages GMX v1/v2 market exposure, oracle health, security outputs, and AI-assisted triage into a client-ready ZIP.

Primary CTA: Request A Sample Bundle

Secondary CTA: Book A Chain Review

### Three-Sentence Pitch

Rigo-Crypto delivers block-pinned GMX review bundles for v1 and v2: market inventory, collateral exposure, oracle risk flags, security appendices, and AI-assisted triage. Arbitrum and Avalanche parity is already validated, with reproducible output bundles generated from one command. Standard pricing starts at $4,500 per chain with 24 to 72 hour turnaround.

### Short Deck Copy

- Deterministic GMX evidence bundle, not a screenshot-only review.
- Machine-readable and executive-readable outputs in the same package.
- Commercially useful for governance checks, collateral onboarding, and upgrade deltas.

## Demo Script

### 60-Second Walkthrough

1. Open the generated HTML report and show the pinned block, chain, and vault context.
2. Scroll to the exposure and risk sections to show top collateral, missing feeds, and concentration.
3. Open the ZIP or manifest to prove the deliverable is portable and hash-backed.
4. Show the AI section last and frame it as analyst acceleration, not final authority.

### Talk Track

"This is not a promise that code is perfect. It is a deterministic evidence bundle that compresses the first 20 to 40 hours of vault review into a reusable package. You get the report, the raw exports, the scan appendix, and the exact block context needed to defend the findings internally."

## Intake Form

Copy this into a form, CRM, or Notion page:

```text
Protocol / Client Name:
Primary Contact:
Email / Telegram:
Target Chain: [Arbitrum / Avalanche / Other]
Mode Needed: [v1 / v2 / both]
Vault Address or GMX Deployment:
Pinned Block: [latest / exact number]
Archive RPC Available: [yes / no]
Require Historical Security Completeness At Pinned Block: [yes / no]
Need Upgrade Diff: [yes / no]
Need AI Triage: [yes / no]
Need Strict Gate Or Warn-Only Output:
Target Repository (optional):
Delivery Deadline:
Budget Range:
Notes / Questions:
```

## Outreach Assets

### Twitter Thread

1. Rigo-Crypto Vault Auditor now generates block-pinned GMX v2 evidence bundles. Latest validated Arbitrum sample: 129 markets, 24 collateral tokens, 0 metadata failures.
2. Same workflow is validated on Avalanche: 20 markets, 10 collateral tokens, 0 metadata failures. Outputs are automated risk flags with deterministic evidence artifacts.
3. Standard turnaround is 24 to 72 hours, starting at $4,500 per chain. DM for a sample bundle or an upgrade diff quote.

### Cold Email

```text
Subject: GMX v2 collateral risk bundle for [Protocol]

Hi [Name],

We package GMX v1/v2 market exposure, oracle checks, security scan appendices, and AI-assisted triage into a block-pinned evidence bundle.

Risk labels indicate operational/oracle/configuration risk from automated checks, not confirmed exploit severity.

Recent validated samples:
- Arbitrum v2: 129 markets, 24 collateral tokens, 0 metadata failures
- Avalanche v2: 20 markets, 10 collateral tokens, 0 metadata failures

Standard turnaround is 24 to 72 hours. Base pricing starts at $4,500 per chain.

If useful, send the target chain, vault, and preferred block and we will quote the review.

Rigo-Crypto
```

### Follow-Up Email After Demo

```text
Subject: Your GMX evidence bundle draft

Hi [Name],

Attached is the sample bundle for [Protocol].

Highlights:
- Markets reviewed: [count]
- Collateral tokens reviewed: [count]
- High-risk items: [count]
- TVL / exposure snapshot: [value]
- AI triage: advisory only, human review required

If you want a production engagement, reply with the final vault, chain, block preference, and delivery deadline.

Rigo-Crypto
```

## Buyer Friction Reducers

### How To Buy

1. Send the intake form by email, DM, or Notion page.
2. Receive quote, delivery ETA, and payment method.
3. Approve scope and provide RPC credentials if private or archive access is required.
4. Receive bundle ZIP plus optional walk-through call.

Single funnel recommendation: route all outreach to intake form first, then handle quote/invoice in one follow-up.

### Payment Options

- Stripe invoice
- USDC invoice
- Bank transfer or wire for larger engagements

## Internal Delivery Checklist

- [ ] Run deliverable command with agreed scope.
- [ ] Open report.html and verify summary and tables render correctly.
- [ ] Confirm manifest includes expected hash records and block context.
- [ ] Confirm archive-partial notice is present when required.
- [ ] Verify ZIP exists and passes size sanity check.
- [ ] Send delivery email with bundle attachment or secure link.

## Testimonial Placeholders

- "The bundle gave our governance team exactly what we needed to evaluate collateral changes without rebuilding the analysis from scratch."
- "The pinned-block manifest and CSV exports made internal review faster than any screenshot-based audit summary."
- "AI triage helped our engineers turn findings into testable invariants instead of vague concerns."

## FAQ

### How fast can you deliver?

Standard turnaround is 24 to 72 hours depending on chain count, archive requirements, and whether a diff or AI package is included.

### Do you need our private RPC?

No, but archive-capable RPC access improves historical completeness, especially for pinned-block security evidence.

### Is AI required?

No. AI is optional and should be treated as analyst acceleration, not as final judgment.

### Can you compare two upgrade states?

Yes. Upgrade diff packages compare two pinned blocks and call out market, collateral, exposure, and risk deltas.

## First Call Script

1. Confirm scope: deterministic config/exposure/oracle review plus optional tool and AI appendices.
2. Show proof: executive screenshot and markets-risk screenshot.
3. Confirm determinism: block hash plus manifest hash records.
4. Confirm delivery inputs: chain, address, block mode, archive policy.
5. Quote package and send invoice during or immediately after call.

## KPI Tracker

Use [docs/kpi-tracker-template.csv](kpi-tracker-template.csv) to track outreach, calls, invoices, and paid engagements weekly.

## Operations Notes

- Prefer archive-capable RPC for historical or security-sensitive reviews.
- Keep the demo bundle current by regenerating it before publishing screenshots.
- Use the HTML report for buyer-facing demos and the CSV/JSON exports for analyst follow-up.

## Changelog

- v0.1: GMX v1 snapshot support.
- v0.2: GMX v2 markets and collateral support.
- v0.3: Bundle packaging plus manifest hashing.
- v0.4: AI triage integration with schema-oriented outputs.
- v0.5: Metadata overrides, RPC resilience improvements, and config-first multi-chain operation.

## Contracting

- SOW template: [docs/sow-template.md](sow-template.md)
- Client handout: [docs/client-handout.md](client-handout.md)
- Demo link pack: [docs/demo/README.md](demo/README.md)
