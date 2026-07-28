# Weekly HackenProof Watch

Generated: 2026-07-28T23:53:38.682590+00:00

## Shortlist (scored)

| Program | Rep | Eco | Critical | Score | Priority | Status | New? | Web | Notes |
|---|---:|---|---:|---:|---|---|:--:|---|---|
| [Strata](https://immunefi.com/bug-bounty/strata/information/) | 0 | EVM | $250,000 | 12 | HIGH | WATCH |  | skipped | Phase 0 clean at commit 07fb443. June-2026 cooldown/CDO/RoundingGuard/UD60x18Ext scope additions postdate the March audits. Revisit on deployment change, new audit, known-issue update, or scope expansion. Immunefi (not HackenProof). |
| [Yearn V3 - Sherlock](https://audits.sherlock.xyz/bug-bounties/30) | 0 | EVM | $200,000 | 12 | HIGH | WATCH |  | skipped | Phase 0 clean at 6c4ccc8. Base Vault.vy/TokenizedStrategy.sol/BaseStrategy.sol excluded as Immunefi duplicates; yRoboTreasury custom paths reduce to trusted roles + accepted auction risks. Sherlock scope is DYNAMIC (yearn.fi/v3). Revisit when a custom strategy is added, yRoboTreasury changes, or a strategy introduces custom valuation/withdrawal/reporting logic. |
| [GMX v2 - Immunefi](https://immunefi.com/bug-bounty/gmx/information/) | 0 | EVM | $5,000,000 | 12 | HIGH | WATCH |  | skipped | Pending/lent-impact Phase 0 clean at 2b08e88. Live v2.2 mechanism reconciled on Arbitrum: split/full decreases telescope, full close clears pending impact, lent impact is symmetric, GM valuation and withdrawal caps are consistent. Revisit on deployed increase-path changes, liquidation/ADL changes, GLV aggregation changes, or a market with active nonzero lent impact. |
| [ShapeShift](https://hackenproof.com/programs/shapeshift) | 50 | EVM | $10,000 | 6 | MEDIUM | CLOSED-NO-FINDING |  | skipped | public source, paid history; rFOX StakingV1 == audited, invariants hold. low max bounty. |
| [Whitechain Bridge](https://hackenproof.com/programs/whitechain-bridge) | 50 | EVM | $100,000 | 4 | LOW | CLOSED-NO-FINDING |  | skipped | centralized bridge; signature domain gap refuted by distinct relayers. |
| [SuperEarn Web & Smart Contracts](https://hackenproof.com/programs/superearn-web-and-smart-contracts) | ? | EVM | $30,000 | 4 | LOW | PAUSED-WATCH |  | skipped | PAUSED-WATCH, HIGH on reopening. Custom cross-chain vault/accounting (Kaia CooldownVault/OriginVault/BridgeAccountant <-> Ethereum RemoteVault); public source superearn-io/superearn-core-public; permissionless flows; direct fund-safety invariants. Foundry-fork reproducible. Saturation HIGH (249 subs, $2.8k paid, 3 Certik reviews). Strategy: DEPLOYMENT-DIFF FIRST. Rep UNCONFIRMED — confirm <=80. See targets/superearn/reports/reopen-checklist.md. Do NOT assess while paused. |
| [RISC Zero Blockchain Verifiers](https://hackenproof.com/programs/risc-zero-blockchain-verifiers) | 50 | EVM | $150,000 | 3 | LOW | PAUSED-TOOLCHAIN |  | skipped | high-value verifier scope, toolchain-heavy; contract surface clean/audit-saturated. paused-toolchain-gate. |
| [Cronos Smart Contracts](https://hackenproof.com/programs/cronos-smart-contracts) | 50 | EVM | $200,000 | 3 | LOW | CLOSED-NO-FINDING |  | skipped | saturated ($0 paid, 146 subs); Fulcrom/Tectonic/Veno faithful forks or privileged. low EV unless scope changes. |
| [Hyperbridge Protocol](https://hackenproof.com/programs/hyperbridge-protocol) | ? | EVM/Rust | $50,000 | 3 | LOW | PAUSED-TOOLCHAIN |  | skipped | PAUSED-TOOLCHAIN. paid $152.5k, 2102 submissions; Solidity Merkle v1.1.0 hardened and independently reconciled (22/22 + 3/3 differential). Residual Rust/ISMP/proxy surface BLOCKED by missing cargo/rustc and lacks a specific consumer-binding lead. Reopen only with a reproducible Rust toolchain + working Rust/Solidity fixtures + a concrete commitment/timeout/proxy/MPT hypothesis not already regression-covered. |

## Changes Since Last Run


### Changed
- **RISC Zero Blockchain Verifiers**: status
- **Hyperbridge Protocol**: status

## Alerts (new HIGH/MEDIUM, actionable)

None. No fresh candidate clears the bar this week — hold active hunting; keep watching. Add newly launched ≤80-rep smart-contract programs to `PROGRAMS` with `status: NEW`.
