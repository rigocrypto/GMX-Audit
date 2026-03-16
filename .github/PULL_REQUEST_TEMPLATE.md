# Pull Request

## Description

<!-- Describe the changes, what invariant was added/fixed, or what bug was resolved. -->

## Security & Privacy Checklist

- [ ] **No secrets leaked**: I have verified that no RPC URLs, private keys, or `.env` files are included in this PR.
- [ ] **Isolated testing**: If I added a test proof, it is generated in `outputs/demo/` and not `exploit-proofs/`.

## Validation Checklist

<!-- Please confirm you have run the following before requesting a review: -->
- [ ] `npm run smoke:all` passes.
- [ ] `npm run demo:proof` runs without errors.
- [ ] `npm run test:gmx-invariants:full` passes (or explains any new pendings).
- [ ] `npm run test:gmx-exploit-search:extended` passes.

## Related Issues
<!-- e.g., Fixes #123 -->