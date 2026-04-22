# Architecture: GMX Audit Control Center

## 1. Purpose
This document defines the target repository structure, ownership boundaries, and migration path from current implementation to Control Center modules.

## 2. Architectural principles
- Static-first rendering for low operational complexity.
- Deterministic artifacts and stable path conventions.
- Schema-versioned data contracts.
- CI-first generation and validation.
- Clear module ownership and minimal cross-module coupling.

## 3. Target repository structure

```text
.
|-- app/
|   |-- cli/
|   |-- orchestrators/
|   \-- jobs/
|-- domain/
|   |-- runs/
|   |-- findings/
|   |-- proofs/
|   |-- triage/
|   |-- scoring/
|   |-- managed/
|   |-- alerts/
|   \-- artifacts/
|-- pipelines/
|   |-- execution/
|   |-- triage/
|   |-- packaging/
|   |-- dashboard/
|   \-- managed/
|-- adapters/
|   |-- sqlite/
|   |-- filesystem/
|   |-- rpc/
|   |-- ci/
|   \-- notifications/
|-- ui/
|   |-- pages/
|   |   |-- overview/
|   |   |-- runs/
|   |   |-- findings/
|   |   |-- proofs/
|   |   \-- score/
|   |-- components/
|   |-- charts/
|   |-- shared/
|   |-- assets/
|   \-- exporters/
|-- schemas/
|   |-- run.schema.v1.json
|   |-- finding.schema.v1.json
|   |-- proof-package.schema.v1.json
|   |-- score-snapshot.schema.v1.json
|   |-- artifact-manifest.schema.v1.json
|   \-- triage-result.schema.v1.json
|-- docs/
|-- scripts/
|-- outputs/
\-- tests/
```

## 4. Recommended sample files

```text
app/orchestrators/build-control-center.ts
pipelines/dashboard/generate-overview.ts
pipelines/dashboard/generate-findings-pages.ts
domain/findings/finding-service.ts
domain/proofs/proof-package-service.ts
adapters/sqlite/run-history-repo.ts
ui/pages/overview/template.ts
ui/pages/findings/detail-template.ts
ui/exporters/static-site-exporter.ts
schemas/finding.schema.v1.json
```

## 5. Ownership boundaries

| Module | Owns | Does not own |
|---|---|---|
| app | Command orchestration | Business logic internals |
| domain | Core entities and rules | Storage and rendering details |
| pipelines | End-to-end generation steps | UI component implementation |
| adapters | External integrations (SQLite, FS, RPC, CI) | Domain decisions |
| ui | Rendering templates and static pages | Triage/scoring logic |
| schemas | Data contracts and validation rules | Execution code |

## 6. Current to target migration map

| Current capability/path | Target module/path | Action |
|---|---|---|
| outputs/triage/triage-result.json | domain/findings + schemas/triage-result.schema.v1.json | Keep format, add schema validation |
| outputs/metrics/dashboard.html | ui/pages/overview + ui/exporters/static-site-exporter | Keep output path, refactor template pipeline |
| proof.json + summary.json + repro scripts + immunefi-report.md | domain/proofs + schemas/proof-package.schema.v1.json | Preserve artifacts, add manifest linkage |
| SQLite-backed history | adapters/sqlite/run-history-repo.ts | Normalize query layer and typed models |
| managed scheduler/retries/locks/pruning | pipelines/managed + domain/managed | Keep behavior, expose status data to UI |

## 7. Data flow

1. Execution pipeline emits run outputs and triage files.
2. Domain services normalize run/finding/proof records.
3. Schema validators gate malformed records.
4. Dashboard pipeline builds static pages using UI templates.
5. Exporter writes pages/assets and validates link integrity.
6. Managed pipeline scopes outputs per client and retention policy.

## 8. Output structure target

```text
outputs/
|-- triage/
|   \-- triage-result.json
|-- metrics/
|   |-- dashboard.html
|   |-- assets/
|   \-- pages/
|       |-- findings/
|       |-- proofs/
|       \-- runs/
|-- proof-packages/
|   \-- <protocol>/<chain>/<runId>/
|       |-- proof.json
|       |-- summary.json
|       |-- repro.sh
|       |-- repro.ps1
|       |-- immunefi-report.md
|       \-- manifest.json
\-- managed/
    \-- <client>/<date>/<runId>/
        |-- triage/
        |-- metrics/
        |-- proofs/
        |-- logs/
        \-- manifest.json
```

## 9. Naming conventions

- Filenames: kebab-case for docs/templates, suffix-based for services and adapters.
- Routes/pages: plural nouns (findings, proofs, runs).
- Schemas: <entity>.schema.v<major>.json.
- Run IDs: timestamp plus short hash (example 2026-04-21T193000Z_ab12cd).
- Manifests: manifest.json with file path, hash, size, schema_version.

## 10. Validation and quality gates

- Validate all schema-versioned JSON before rendering.
- Verify that every page link resolves to an existing artifact.
- Fail CI on schema mismatch or broken export links.
- Emit build metadata summary for traceability.

## 11. Future expansion (optional)

- API mode exposing normalized run/finding/proof entities.
- React/Vite front-end shell over static datasets.
- Hosted multi-tenant dashboard with RBAC.
- Queue-backed orchestration for high-frequency managed workloads.
