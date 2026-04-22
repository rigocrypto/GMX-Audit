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

## Transitive Dependency Risk: elliptic

This repository includes a transitive dependency on elliptic via development tooling in the Hardhat ecosystem.

- Usage scope: development and testing only
- Production runtime: excluded via npm ci --omit=dev
- No cryptographic signing or key generation in this system relies on elliptic

As of this writing, no patched upstream version of elliptic exists for the reported issue affecting ECDSA nonce handling.

Risk assessment:

- No exposure in production runtime
- No use in key management or signing flows
- Dependency is isolated to local testing and CI environments

Status:

Risk is accepted and monitored pending upstream remediation.
The dependency will be updated or removed when a patched version or alternative becomes available.

## Stripe Billing Security

Managed billing integrations must follow these controls:

- Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only in environment variables or secret managers.
- Verify every Stripe webhook signature before processing payloads.
- Treat webhook event IDs as idempotency keys; never process the same event twice.
- Never store card numbers, CVC, or full payment method payloads in local databases.
- Use HTTPS-only webhook endpoints in deployed environments.
