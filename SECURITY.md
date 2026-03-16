# Security Policy

## Reporting a Vulnerability

Do not open public GitHub issues for exploitable findings.

Use private channels and include:

- impacted chain and fork block
- detector name
- proof artifact (`proof.json`) or reproduction steps
- economic impact estimate and assumptions

Preferred contact:

- Security contact: <security@gmx-audit.local>
- Optional encrypted submission: include your PGP public key and request encrypted follow-up

Response targets:

- Acknowledge report within 72 hours
- Provide triage status update within 7 calendar days

If you are preparing an Immunefi submission, package evidence with:

```bash
npm run proof:package -- --file exploit-proofs/<proof>.json --outDir proof-packages --price <ETH_USD>
```

## Safe Disclosure Notes

- Keep live exploit details private until coordinated disclosure is agreed.
- Do not run testing against mainnet state-changing endpoints.
- Findings should include both PoC and economic impact analysis.

## Scope

In scope:

- repository scripts, workflows, and packaging logic
- deterministic triage and reporting outputs
- CI and automation behavior in this repository

Out of scope:

- vulnerabilities in upstream GMX contracts unless demonstrated through this repo's PoC workflow
- third-party infrastructure incidents outside repository code paths
