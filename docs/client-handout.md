# Rigo-Crypto Vault Auditor: Client Handout

## Offer Summary

Rigo-Crypto delivers block-pinned GMX v1/v2 evidence bundles that combine exposure analysis, oracle-health checks, security appendices, and optional AI-assisted triage.

Scope clarification: risk labels in this package represent operational/oracle/configuration risk flags from deterministic rules and tooling, not confirmed exploit severity.

## Proof

| Chain | Mode | Block | Markets | Collateral Tokens | Metadata Failures |
| --- | --- | ---: | ---: | ---: | ---: |
| Arbitrum | v2 | 441411191 | 129 | 24 | 0 |
| Avalanche | v2 | 80289924 | 20 | 10 | 0 |

Market counts reflect chain-specific deployed market sets at the sampled block.

## Deliverables

- `report.html` and `report.md`
- `audit.csv` and `audit.json`
- `manifest.json` with block context and hash records
- Security outputs and optional AI triage artifacts
- Single ZIP package for handoff

## Scope To Output Map

| Client asks for | Requires | Output section |
| --- | --- | --- |
| Pinned block with full security completeness | Archive-capable RPC | Security summary and security tool outputs |
| USD exposure analysis | Chainlink feed coverage | Exposure tables and stale/missing feed alerts |
| AI triage package | AI runtime reachable | `ai_findings` and invariant suggestions |

## Pricing And Turnaround

| Package | Turnaround | Price |
| --- | --- | ---: |
| Standard | 48h target | $4,500 per chain |
| Multi-Chain Bundle (Arbitrum + Avalanche) | 48h target | $8,500 |
| Rush | 24h target | +50% |
| Extra chain | Added to same engagement | +$1,500 per chain |
| Upgrade diff (two blocks) | Added to same engagement | +$3,500 |
| AI triage add-on | Added to same engagement | +$1,500 |

## Single CTA Funnel

Use one action in outreach: submit intake details first, then receive quote and invoice.

- Intake destination: [docs/sales-launch-kit.md](sales-launch-kit.md)
- Response SLA: quote and ETA returned after intake review

## What We Need To Start

- Target chain and vault/deployment address
- Preferred block mode: `latest` or pinned number
- Archive RPC availability: `yes` or `no`

## Intake Link

- Sales playbook and intake template: [docs/sales-launch-kit.md](sales-launch-kit.md)

## How To Buy And Payment

- To proceed, email or DM intake details from the launch-kit form.
- We send a Stripe invoice and confirm delivery ETA.
- Payment terms: 100% upfront for engagements under $10k, Net-7 available for returning clients.
- Delivery method: encrypted ZIP plus bundle hash summary via email or Signal.

## Confidentiality And Data Handling

- Client RPC keys are treated as confidential and are not retained after delivery.
- Manifests and shared artifacts can be redacted to avoid exposing RPC host details.
- Delivered bundles are retained for 30 days by default unless otherwise requested.
- Optional NDA support is available for enterprise or pre-release engagements.

## Demo Policy

- Public demo: screenshots plus redacted `report.md` excerpts.
- Private demo (NDA or direct sales cycle): full ZIP bundle.

## Scope Notes

- Not a full manual smart contract audit.
- AI outputs are advisory only and require human validation.
- Pinned-block historical security completeness requires archive-capable RPC.

## Change Request Policy

- One revision is included for corrected address input or updated block target.
- Additional revisions are billed as reruns under current pricing terms.
