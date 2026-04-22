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

### Changed
- Upgraded dashboard generator overview template to Control Center layout
- Added deterministic score formula panel (Critical -25, High -15, Medium -5, Low -1, clamped 0..100)
- Wired schema-validated triage and proof summary inputs into overview cards and latest findings table
- Replaced non-deterministic generated timestamp rendering with artifact-derived metadata
