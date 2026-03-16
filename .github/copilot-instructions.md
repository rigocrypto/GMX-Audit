# GMX Audit Workspace - Copilot Instructions

You MUST:
1) Search existing code before calling any helper.
2) Read these files before edits:
   - test/gmx-invariants/harness.ts
   - package.json scripts
   - .env keys used in specs
3) If a helper is missing, implement it in harness.ts first with typed signatures.
4) Do not change existing invariant semantics unless explicitly requested.
5) Always validate with:
   - npm run test:gmx-invariants:full
   - npm run test:gmx-exploit-search:extended (for exploit-search changes)
6) Keep outputs deterministic:
   - use withIterationSnapshot for fuzz loops
   - keep random inputs reproducible with documented seeds where applicable
7) Immunefi scope constraints:
   - no mainnet testing
   - no third-party oracle blame findings
   - findings require PoC plus economic impact (theft, insolvency, freeze)
8) For new tests:
   - add one deterministic test first
   - then add fuzz variants

Repository-specific notes:
- Hardhat historical reads on Arbitrum can fail due to hardfork lookup limits.
- Prefer readAtForkBlock from harness.ts for baseline-state reads.
- Use GMX_ENABLE_REAL_MUTATIONS=true for exploit-search suites.
