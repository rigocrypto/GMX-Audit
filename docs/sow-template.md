# Statement of Work Template

## Engagement Overview

- Client:
- Provider: Rigo-Crypto
- Engagement name:
- Effective date:
- Target delivery date:

## Scope

Rigo-Crypto will produce a block-pinned GMX evidence bundle for the agreed chain and addresses, including exposure analysis, oracle-health checks, security appendices, and optional AI-assisted triage as selected.

### In Scope

- Chain and address set agreed in intake.
- Selected block mode (`latest` or pinned block).
- Core bundle outputs: HTML report, Markdown report, CSV, JSON, manifest, ZIP.
- Security outputs and AI triage outputs when selected.

### Out Of Scope

- Full manual smart contract audit.
- Formal verification unless explicitly added.
- Guaranteed exploit discovery.

## Deliverables

- `report.html`
- `report.md`
- `audit.csv`
- `audit.json`
- `manifest.json`
- Security and AI outputs as contracted
- Final ZIP package
- Versioned bundle directory name with chain, vault, block, and date context

## Timeline And SLAs

- Standard SLA: 48-hour target from kickoff and complete intake.
- Rush SLA: 24-hour target with rush surcharge.
- One revision included for updated address or block inputs.

## Commercial Terms

- Base price per chain:
- Add-ons selected:
- Total fee:
- Payment terms: 100% upfront for engagements under $10k; Net-7 available for returning clients by approval.

## Change Request Policy

- One revision included for corrected target input or updated block.
- Additional revisions are billed per rerun under agreed commercial terms.

## Scope To Output Map

| Requested scope | Required input | Evidence output |
| --- | --- | --- |
| Pinned block with full security completeness | Archive-capable RPC | Security summary plus tool output files |
| USD exposure analysis | Feed coverage for tracked assets | Exposure and feed-alert sections |
| AI triage package | AI runtime access | AI findings and invariant suggestions |

## Assumptions

- Client provides accurate addresses and target chain.
- Archive-capable RPC is required for pinned-block historical security completeness.
- If archive RPC is not available, security section may be marked partial.

## Limitations And Disclaimers

- USD exposure depends on mapped and available feed coverage.
- AI outputs are advisory and require human validation.
- Risk severities represent operational and configuration risk, not guaranteed exploit severity.

## Confidentiality And Data Handling

- RPC credentials are treated as confidential and not retained after delivery.
- Artifacts can be redacted to remove sensitive host details.
- Bundles are retained for 30 days by default unless otherwise agreed.
- NDA terms can be attached as an addendum.

## Liability Cap

Except for gross negligence or willful misconduct, provider liability is limited to fees paid under this SOW.

## Acceptance Criteria

- Bundle includes required deliverables listed above.
- Manifest includes block context and hash entries.
- Partial-history caveat is present when archive completeness is unavailable.

## Sign-Off

- Client representative / date:
- Provider representative / date:
