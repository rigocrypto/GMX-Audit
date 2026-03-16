# gmx-audit

Deterministic GMX security harness for invariant hunting, triage, and Immunefi-ready proof packaging.

[![Bounty Rotation CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/bounty-rotation.yml)
[![Audit Batch CI](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml/badge.svg?branch=main)](https://github.com/rigocrypto/bounty-rotation-harness/actions/workflows/audit-batch.yml)
![Demo](https://img.shields.io/badge/demo-proof-green)
![License](https://img.shields.io/badge/license-MIT-black)

- Continuous operations guide: [docs/continuous-security.md](docs/continuous-security.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## One-Command Bounty Hunt

```bash
npm ci
cp .env.example .env
npm run bounty-rotation
```

What this runs:

- extended exploit-search suite
- triage result generation (`outputs/triage/triage-result.json`)
- dashboard generation (`outputs/metrics/dashboard.html`)

## Supported Environments

- Node.js 20.x
- GitHub Actions `ubuntu-latest`
- Windows PowerShell (local commands and repro scripts)

RPC expectations:

- Archive RPC is required for deterministic historical fork reads.
- `eth_blockNumber` is required for preflight health checks.
- Read-heavy endpoints are expected; do not use state-changing mainnet paths.

## Demo Mode (No Live Finding Required)

Generate a deterministic synthetic proof and package it into an Immunefi-ready bundle:

```bash
npm run demo:proof -- --price 2172.24
```

By default this writes to isolated demo-only paths:

- `outputs/demo/proofs/demo-proof.json`
- `outputs/demo/proof-packages/...`

This is intended for product demos and onboarding. It does not claim a live exploit.

## Scope and Truth-in-Reporting

- Use the term "bounty candidate" unless a human-reviewed submission is ready.
- Keep price basis explicit in report output and triage metadata.
- Prefer sanitized bundle sharing for public demos.
- Preferred claim language: "Immunefi-ready proof package in ~2 minutes (demo)".

## Common Failures

- RPC rate limits (`429`/timeouts): retry with backoff or switch provider.
- Missing archive access: set a proper archive endpoint in `.env`.
- Log encoding artifacts on Windows: use UTF-8 terminal output when piping logs.

## Quick Start (Vault Audit Path)

1. Install dependencies:

```bash
npm install
```

1. Run an AI-enabled audit (pass vault via CLI):

```bash
npm run audit:ai -- 0x489ee077994B6658eAfA855C308275EAd8097C4A --block 200000000 --rpc https://arb1.arbitrum.io/rpc
```

1. Output bundle example:

```text
outputs/bundles/arbitrum_0x489ee077994b6658eafa855c308275ead8097c4a_200000000/
```

## GMX v2 Arbitrum Invariant Suite

Current result: 22 passing, 0 pending.

Environment:

- network: Arbitrum
- fork pin: block `420000000`
- markets: WETH/USDC and WBTC/USDC

Profiles:

- fast (CI gate): `npm run test:gmx-invariants`
- stress (nightly/manual): `npm run test:gmx-invariants:stress`

Suite inventory:

- `test/gmx-invariants/vaultAccounting.spec.ts`: fee attribution and pool accounting round-trip
- `test/gmx-invariants/liquidation.spec.ts`: liquidation safety, position clearing, solvency boundaries
- `test/gmx-invariants/glpAum.spec.ts`: AUM and exchange-router vs vault accounting consistency
- `test/gmx-invariants/sequenceDrift.spec.ts`: open -> partial close -> increase -> overwithdraw -> liquidate regression

Assumptions, oracle model notes, funding model, and interpretation boundaries are documented in [docs/test-assumptions.md](docs/test-assumptions.md).

## Consulting Deliverable Command

Use this single command to produce a client-ready package with reports, manifests, security artifacts, AI triage, and a zip file:

```bash
npm run deliverable -- 0x489ee077994B6658eAfA855C308275EAd8097C4A --block 200000000 --rpc https://arb1.arbitrum.io/rpc --client RigoCrypto --engagement whitelist-review
```

Optional labeling and packaging flags:

- `--client <name>`: prepends client label in default bundle directory name.
- `--engagement <name>`: prepends engagement label in default bundle directory name.
- `--zip`: writes a zip archive next to the bundle directory.
- `--zip <path>`: writes zip to a custom path.

Mode and chain config flags:

- `--mode auto|v1|v2`: target mode selection (`auto` default).
- `--chain-id <id>`: require/lock expected chain id from RPC.
- `--require-archive`: fail fast if RPC cannot serve historical state for requested block.
- `--recommend-archive-rpc` / `--no-recommend-archive-rpc`: control archive remediation hints when output is partial.

If no vault is passed, the tool will use `configs/chains/<chainId>.*.json` and default to `gmxV1.vault` when configured.

Chain config fields used for onboarding:

- `name`, `chainId`
- `explorer.apiBase`
- `gmxV1.vault`
- `gmxV2.dataStore`, `gmxV2.reader`, `gmxV2.vault`/`gmxV2.vaults`
- `chainlinkFeedsByToken`
- `nativeWrappedToken`

Example (config-driven default vault):

```bash
npm run deliverable -- --rpc https://arb1.arbitrum.io/rpc --block 200000000 --client RigoCrypto --engagement whitelist-review --mode auto --zip
```

## Docker Runtime

1. Start stack:

```bash
docker compose up -d
```

1. Pull model once:

```bash
docker exec -it gmx-ollama ollama pull qwen2.5-coder:7b
```

1. Run an audit inside container:

```bash
docker exec -it -e GMX_VAULT_ADDRESS=0x489ee077994B6658eAfA855C308275EAd8097C4A gmx-vault-auditor npm run audit:ai -- --block 200000000 --rpc https://arb1.arbitrum.io/rpc
```

## Monetization-Ready Packaging

- OSS CLI: free local usage.
- Hosted API: paid tiers based on runs, private RPC, and support.
- Enterprise: annual license with custom detectors and SLAs.

## Commercial Positioning

This repository can also be packaged as a client-facing GMX review service: pinned-block evidence bundles, market and collateral exposure analysis, oracle-risk flags, security appendices, and optional AI-assisted triage.

Commercial launch copy, pricing, intake flow, and outreach templates live in [docs/sales-launch-kit.md](docs/sales-launch-kit.md).

Scope note:

- This tool is suitable for deterministic configuration, exposure, and oracle-health reviews.
- It is not a substitute for a full manual smart contract audit.
- AI output is advisory and must be human-reviewed.

## Landing Page Snippet

Use this copy for your marketing site:

Title: Audit GMX Vaults In Minutes
Subtitle: Deterministic on-chain snapshots, security findings, and AI triage in one bundle.
CTA 1: Start Free CLI
CTA 2: Get API Access
Proof points:

- Block-pinned reproducible outputs
- Security + AI combined findings
- CI gate JSON for automated policy checks

## Minimal API Contract

POST /api/audit
Headers:

- Authorization: Bearer API_KEY

Body:

```json
{
   "vault": "0x...",
   "block": 200000000,
   "rpc": "https://arb1.arbitrum.io/rpc",
   "mode": "full"
}
```

Response:

```json
{
   "jobId": "audit_123",
   "status": "queued",
   "bundlePath": "outputs/bundles/...",
   "reportHtml": "outputs/reports/...",
   "gate": {
      "passed": true,
      "high": 0,
      "medium": 1
   }
}
```

## Important Note About Vault Addresses

Address strings can be mixed-case but not checksum-valid. The scripts normalize any valid 40-hex address input so copy-paste inputs are accepted.

If a target contract is not a GMX v1 vault, the tool now returns a clear message indicating that v1 whitelist getters are missing.
