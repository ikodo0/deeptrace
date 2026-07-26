# Live Source Scope — Messari standardized subgraphs on Base

## Status

**Current as of 2026-07-26.** Both public tools read Messari standardized
subgraphs (`source_type: "standardized_subgraph"`) on Base. The native
Uniswap-V3-lineage selection that MVP-0 previously shipped is retired; its
record is kept at the end of this document.

- `compare_pools` binds one Messari `dex-amm` deployment twice, once per
  WETH/USDC fee tier, and composes it with the Nuthatch swap-freshness view.
- `compare_lending_markets` runs one Messari lending query template against
  three unrelated Base lending protocols on the native-USDC market.

Base publishes exactly one healthy Messari `dex-amm` deployment, so a
two-protocol DEX comparison inside the standardized category is not available.
Rather than mix schema tiers, DEX breadth comes from two fee tiers of the same
standardized source, and cross-protocol reuse of the standard is demonstrated
by the lending tool.

## Locked inputs

- Chain: Base (`chain_id` 8453).
- Pool pair: WETH `0x4200000000000000000000000000000000000006` (18 decimals) /
  native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` (6 decimals).
- Lending market asset: native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`.
- Schema tier: Tier A, Messari standardized. Every record pins the publisher's
  `schemaVersion` and `methodologyVersion` in `records.json`.

## `compare_pools` sources

Query `tier-a-dex-pool-metrics-v1`, subgraph
`FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS`, deployment
`QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh`, schema `4.0.1`, methodology
`1.0.0`.

| `source_id` | Pool | Fee tier |
| :--- | :--- | :--- |
| `messari-uniswap-v3-base-fee030` | `0x6c561b446416e1a00e8e93e221854d6ea4171372` | 30 bps (`feePercentage` `0.3`) |
| `messari-uniswap-v3-base-fee005` | `0xd0b53d9277642d899df5c87a3966a349a798f224` | 5 bps (`feePercentage` `0.05`) |

Nuthatch continues to supply the swap-freshness fact for the 0.3% pool through
`nuthatch-pool-swaps`.

### Field mapping and its one methodology caveat

| Canonical field | Messari source |
| :--- | :--- |
| `pool_address` | `liquidityPool.id` |
| `token0` / `token1` | `liquidityPool.inputTokens[0]` / `[1]` — note `decimals` is an `Int` here, not the `String` native subgraphs return |
| `fee_tier_bps` | `liquidityPool.fees` entry with `feeType: "FIXED_TRADING_FEE"`, whose `feePercentage` is a percent string scaled to basis points |
| `tvl_usd` | `liquidityPool.totalValueLockedUSD` |
| `volume_usd_*` | `liquidityPoolDailySnapshots.dailyVolumeUSD` |
| `fees_usd_*` | `liquidityPoolDailySnapshots.dailyTotalRevenueUSD` |

**The `dex-amm` standard has no per-day fee field.** `dailyTotalFeesUSD` does not
exist; the closest published value is `dailyTotalRevenueUSD`, the sum of
supply-side and protocol-side revenue accrued that day. On both compared pools
`dailyProtocolSideRevenueUSD` is `0`, so the value equals LP fees today — but
that is a property of those pools, not a conversion DeepTrace performs. The
mapping is recorded in `M0_POOL_METRICS_METHODOLOGY.fees_usd`.

Snapshots are keyed by `day`, the count of days since the unix epoch, rather
than by a midnight timestamp. The adapter multiplies by 86 400 before handing
snapshots to the shared completed-UTC-day aggregator, so window semantics are
identical across both schema tiers.

## `compare_lending_markets` sources

Query `tier-a-lending-market-metrics-v1`, one document served unchanged by all
three deployments.

| `source_id` | Protocol | Subgraph ID | Deployment ID | Schema |
| :--- | :--- | :--- | :--- | :--- |
| `messari-aave-v3-base` | Aave v3 | `D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9` | `Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL` | `3.1.0` |
| `messari-seamless-base` | Seamless Protocol | `2u4mWUV4xS19ef1MbnxZHWLLMwdPxtVifH46JbonXwXP` | `QmPSmTkJPSKLFn46YdgwMKV5K2c9a3pkWnzDCC4ccCLAXE` | `3.1.0` |
| `messari-moonwell-base` | Moonwell | `33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg` | `QmeE6TgfRmK2iLAgCLBeXuxJQ2VXLFAeHVMTvmnECiFw7y` | `2.0.1` |

Rates are the source-reported `Market.rates` entries, in percent, passed through
as decimal strings. `LENDER`/`VARIABLE` and `BORROWER`/`VARIABLE` are present on
all three; `BORROWER`/`STABLE` is absent on Moonwell and is reported as `null`
rather than zero. The Seamless USDC market currently reports `isActive: false`;
it is returned with that flag and a warning rather than dropped, because the
balances and rates it reports are still real.

Compound v3 was rejected: the published Base query ID answers with
`network: MAINNET`, so it cannot be part of a Base-locked comparison. Because a
deployment listed for one network can index another, the lending query reads
`lendingProtocols.network` back and the adapter rejects any response that does
not self-report `BASE`. All three shipped deployments do.

## Deployment assertion

Every accepted Graph response must report `_meta.deployment` equal to the
registry-pinned hash using an exact, case-sensitive comparison. A mismatch maps
to `status: "unsupported"`, `data: null`, and a warning naming both hashes.
Reliable freshness from the same `_meta` response may be retained. Lending
responses additionally have to self-report the expected network; see above.

## Evidence and limitations

Tier-A pool captures live under `tests/integration/__evidence__/m3/` and are
replayed by the unit suite, which also asserts the captured request text still
equals the shipped query constant. Re-capture with:

```sh
GRAPH_API_KEY=... node scripts/m3/capture-tier-a-evidence.mjs
```

The earlier Tier-B scouting sweep stays under
`tests/integration/__evidence__/m2/`. Captures are point-in-time observations;
publishers may update the deployment behind a stable subgraph ID, which is
exactly what the deployment assertion exists to catch.

## Superseded: the M2 native Tier-B selection

The prior scope compared two native Uniswap-V3-lineage deployments — Uniswap V3
`QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR` (pool
`0x6c561b44…`, 30 bps) and PancakeSwap V3
`QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g` (pool `0x72ab388e…`, 1 bps) —
after the original three-source criterion went unmet and Aerodrome
(`GENunSHWLBXm59mBSgPzQ8metBEp9YDfdqwFr91Av1UM`) exceeded the binding 15-second
pool-discovery deadline. That sweep also established why the other candidates
were unusable: SushiSwap's `factories` marker was coincidental and its lineage
has no compatible `Pool`/`PoolDayData`; Aerodrome Slipstream renames or omits
required pool and day fields; Balancer V2, BaseSwap V2, and the first Pancake
candidate matched neither supported tier; four community candidates returned no
usable `_meta` deployment.

No profile binds the native tier today, but the `m2-tier-b-metrics-v1` query and
its adapter path remain implemented and tested, so a native deployment can be
compared again through a `records.json` plus `compare-pools.json` edit alone.
