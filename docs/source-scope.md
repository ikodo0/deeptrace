# M2 Live Source Scope — Amended to two sources

## Status

**Amended 2026-07-25 by owner decision: MVP-0 ships with two same-tier Graph
sources instead of three.** The two validated Tier-B deployments below are the
final M2 selection, and `src/registry/records.json` is finalized from them.

The original three-source criterion was not met, and this is a deliberate scope
reduction rather than a satisfied gate. Aerodrome was neither retried nor
replaced; no tier mixing or silent fallback was introduced. The third source
remains available as a later addition: adding it is a `records.json` plus
`compare-pools.json` edit, with no loader or adapter change, because the
same-tier invariant is enforced across whatever set is configured.

The exit criterion for M3 changes accordingly — one call returns **two** valid
`SourceResult` values, not three.

### Prior status, retained for the record

M2 ended blocked as of the 2026-07-25 capture. The required three compatible
deployments and pools were not demonstrated. Two Tier-B deployments passed the
native-USDC pool and common-query checks; Aerodrome pool discovery timed out.
No retry, tier mixing, silent fallback, fixture rewrite, or `PLAN.md` scope lock
was performed.

## Locked inputs

- Chain: Base (`chain_id` 8453).
- Base token: WETH `0x4200000000000000000000000000000000000006`,
  symbol `WETH`, 18 decimals.
- Quote token: native USDC
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, symbol `USDC`,
  6 decimals.
- Schema tier under review: Tier B, Uniswap-V3 native lineage.
- Versions: `null`; Tier-B deployments do not publish Messari schema or
  methodology versions.

The token probes also found USDbC consistently, but native USDC remained the
default and was used for pool discovery.

## Validated sources

| Protocol | Subgraph ID | Deployment ID | Pool | Fee | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Uniswap V3 | `GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz` | `QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR` | `0x6c561b446416e1a00e8e93e221854d6ea4171372` | 30 bps (`feeTier` 3000) | Common query returned TVL and non-zero daily volume/fees. |
| PancakeSwap V3 | `BHWNsedAHtmTCzXxCCDfhPmm6iN9rxUhoRHdHKyujic3` | `QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g` | `0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38` | 1 bps (`feeTier` 100) | Common query returned TVL and non-zero daily volume/fees. |

Both pool responses agree on the configured WETH and native-USDC addresses,
symbols, and decimals. The exact `m2-tier-b-metrics-v1` query document returned
the pool plus `poolDayDatas` for both.

## Blocking third source

Aerodrome Full was healthy at the metadata, marker, lineage, and token stages:

- Subgraph ID:
  `GENunSHWLBXm59mBSgPzQ8metBEp9YDfdqwFr91Av1UM`
- Deployment ID:
  `QmasYjypV6nTLp4iNH4Vjf7fksRNxAkAskqDdKf2DCsQkV`

Its native-USDC pool-discovery request exceeded the binding 15-second deadline.
The failure is preserved in `aerodrome-base-full/05-pools.json`. The scouting
policy forbids retries that mask failures, and the user chose to stop rather
than expand candidate scope or manually review Aerodrome.

## Candidate decisions

- Tier A had only one healthy candidate, Messari Uniswap V3, so it could not
  satisfy the three-source rule.
- SushiSwap's `factories` marker was coincidental: its lineage evidence has no
  compatible `Pool` or `PoolDayData`.
- Aerodrome Slipstream renames or omits required pool/day fields, breaking the
  one-template rule.
- Balancer V2, BaseSwap V2, and the first Pancake candidate did not match either
  supported tier.
- Four community candidates returned no usable `_meta` deployment and were
  rejected.
- The alternate Uniswap deployment was not promoted because its token probe
  timed out and it would not provide a distinct third protocol.

## Deployment assertion

Every accepted Graph response must report `_meta.deployment` equal to the
registry-pinned hash using an exact, case-sensitive comparison. A mismatch maps
to `status: "unsupported"`, `data: null`, and a warning naming both hashes.
Reliable freshness from the same `_meta` response may be retained.

## Evidence and limitations

Evidence is stored under `tests/integration/__evidence__/m2/`. The manifest
records the reference block, per-candidate outcome, token decision, two
validated selections, and the blocker. Captures are point-in-time observations;
publishers may update the deployment behind a stable subgraph ID.

Because the M2 exit criterion was not met:

- `src/registry/records.json` was not finalized;
- live fixtures were not substituted;
- the `PLAN.md` scope table remains unresolved;
- M2.5 through M2.9 and M2 complete remain unticked.
