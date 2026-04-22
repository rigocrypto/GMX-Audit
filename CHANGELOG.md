# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- GMX Audit Control Center product positioning and README rewrite
- PRD with prioritized requirements and MVP boundary
- Architecture doc with current-to-target migration map
- Implementation roadmap with issue-sized tasks
- Messaging guardrails for security claim safety
- Starter JSON schemas (v1) for triage, finding, run, proof, score, manifest
- Schema validation script and CI integration
- Sample dashboard in examples/sample-dashboard/
- Findings explorer page with severity badges, proof links, and summary counts bar
- Navigation link from overview findings table to explorer page
- Sample seed data under `examples/sample-data/` with 3 representative fictional findings
- Sample disclaimer banner in generated pages when run with `--sample` flag
- `dashboard:sample` npm script for one-command sample regeneration
- Per-finding detail pages with severity, impact, protocol, and block metadata
- Reproduction command blocks (bash and PowerShell) on detail pages
- Evidence artifact links on detail pages (proof.json, summary.json, immunefi-report.md)
- Back-navigation from detail pages to findings explorer
- Security Score explanation panel with deterministic breakdown by severity
- Scoring model version (v1) and interpretation guidance on overview dashboard
- Stripe billing integration for managed service tiers
- Webhook handler with signature verification and event deduplication
- Billing state service with plan-based entitlements
- Managed service billing gate for run and dashboard access
- Stripe Billing Portal endpoint with auth guard and rate limiting
- Billing DB schema with migration and seed scripts
- Operational scripts: migrate, seed, status, webhook server
- Billing test suite (11 tests passing)
- Billing CI workflow with explicit permissions
- Stripe integration architecture doc
- Billing operational runbook with Stripe CLI validation checklist

### Changed
- Upgraded dashboard generator overview template to Control Center layout
- Added deterministic score formula panel (Critical -25, High -15, Medium -5, Low -1, clamped 0..100)
- Wired schema-validated triage and proof summary inputs into overview cards and latest findings table
- Replaced non-deterministic generated timestamp rendering with artifact-derived metadata

### Fixed
- CodeQL alerts: polynomial regex, missing rate limit, workflow permissions
- CI lockfile mismatch for tsx dependency tree
