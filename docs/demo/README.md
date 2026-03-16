# Demo Bundle Link Pack

Use this page as a frictionless proof asset for prospects.

## Latest Demonstration Bundles

- Arbitrum full deliverable bundle:
  [outputs/bundles/RigoCrypto_v2-live-arbitrum-parity_arbitrum_0xceaadfaf6a8c489b250e407987877c5fdfcdbe6e_441411191_20260313.zip](../../outputs/bundles/RigoCrypto_v2-live-arbitrum-parity_arbitrum_0xceaadfaf6a8c489b250e407987877c5fdfcdbe6e_441411191_20260313.zip)
- Avalanche parity bundle:
  [outputs/bundles/RigoCrypto_v2-live-avalanche-check_avalanche_0x6d5f3c723002847b009d07fe8e17d6958f153e4e_80289924_20260313.zip](../../outputs/bundles/RigoCrypto_v2-live-avalanche-check_avalanche_0x6d5f3c723002847b009d07fe8e17d6958f153e4e_80289924_20260313.zip)

## How These Were Generated

### Arbitrum

```powershell
npm run deliverable -- --mode v2 --rpc https://arb1.arbitrum.io/rpc --block latest --client RigoCrypto --engagement v2-live-arbitrum-parity --zip --usd --risk --ai
```

### Avalanche

```powershell
npm run deliverable -- --mode v2 --rpc https://api.avax.network/ext/bc/C/rpc --block 80289924 --client RigoCrypto --engagement v2-live-avalanche-check --zip --usd --risk
```

## Notes For Outreach

- Share only sanitized bundles externally if required by policy.
- Keep this pack updated with the most recent successful run.
- Pair this pack with [docs/client-handout.md](../client-handout.md) for first-touch outreach.

Public sharing policy:

- Preferred: share screenshots plus redacted report excerpts.
- Optional: share full ZIP only after redaction review of contents.

Demo tiers:

- Public tier: screenshots + redacted markdown excerpts.
- Private tier (NDA): full ZIP evidence bundle.

Primary CTA recommendation: route prospects to intake first, then quote and invoice.

## Refresh Commands

```powershell
npm run capture:setup
npm run demo:refresh
```

`demo:refresh` selects the newest Arbitrum bundle folder, captures screenshots into `docs/assets`, and writes bundle metadata to `docs/demo/LATEST_BUNDLE.txt`.

## Demo Freeze Option

To pin marketing assets to a stable bundle for a campaign week, create:

- `docs/demo/DEMO_BUNDLE_OVERRIDE.txt`

The file can contain either:

- A bundle folder name under `outputs/bundles`
- A relative or absolute path to a bundle folder

When the override file exists and resolves, `demo:refresh` uses it instead of newest-by-date selection.
