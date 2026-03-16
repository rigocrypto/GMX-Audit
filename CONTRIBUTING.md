# Contributing

Thanks for contributing to gmx-audit.

## Development Environment

- Node.js: 20.x
- npm: bundled with Node 20
- Shells tested: Ubuntu bash and Windows PowerShell

## Quick Contributor Flow

1. Install dependencies:

```bash
npm ci
```

1. Run smoke checks:

```bash
npm run smoke:all
```

1. Run deterministic demo path:

```bash
npm run demo:proof -- --price 3400
```

## Adding or Updating Invariants

1. Add deterministic tests first under `test/gmx-invariants/`.
2. Add fuzz or stress variants after deterministic coverage is stable.
3. Re-run required suites:

```bash
npm run test:gmx-invariants:full
npm run test:gmx-exploit-search:extended
```

## Adding a New Chain or Market Context

1. Extend chain defaults and market config in harness/deployed helpers.
2. Keep fork blocks deterministic for CI reproducibility.
3. Document required environment keys in `.env.example`.

## PR Safety Rules

- Never commit RPC URLs with credentials, API keys, or secret tokens.
- Keep proof/demo artifacts out of commits unless explicitly requested.
- Use `outputs/demo/` for demo-only files.
- Include command output summary in PR description for changed behavior.

## Pull Request Checklist

- [ ] `npm run smoke:all` passes
- [ ] Relevant tests pass
- [ ] No secrets added
- [ ] Docs updated for user-facing behavior changes
