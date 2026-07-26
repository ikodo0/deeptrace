/**
 * Locked metrics queries for compare_pools Graph sources.
 *
 * Query identity must stay aligned with `src/registry/compare-pools.json`:
 * the profile names the query a binding is served with, and the adapter
 * refuses any id it does not implement.
 */

const META = `_meta {
    block { number timestamp hash }
    hasIndexingErrors
    deployment
  }`;

/**
 * Tier-A metrics over the Messari `dex-amm` standard, which is what
 * `compare_pools` ships against.
 *
 * Field notes that are easy to get wrong:
 * - snapshots expose `day` (days since the unix epoch), not a midnight
 *   timestamp, so the adapter converts before aggregating;
 * - the standard has no per-day fee field. `dailyTotalRevenueUSD` is the
 *   supply-side plus protocol-side revenue accrued that day, which is the
 *   value mapped onto `fees_usd`;
 * - eight days are requested so seven completed UTC days survive after the
 *   in-progress day is discarded.
 */
export const TIER_A_METRICS_QUERY_ID = "tier-a-dex-pool-metrics-v1" as const;

export const TIER_A_METRICS_QUERY = `query TierADexPoolMetrics($pool: ID!) {
  ${META}
  liquidityPool(id: $pool) {
    id totalValueLockedUSD
    inputTokens { id symbol decimals }
    fees { feePercentage feeType }
  }
  liquidityPoolDailySnapshots(
    first: 8
    orderBy: day
    orderDirection: desc
    where: { pool: $pool }
  ) { day dailyVolumeUSD dailyTotalRevenueUSD }
}`;

/**
 * Tier-B metrics over the native Uniswap-V3-style schema. No shipped profile
 * binds it today; it stays implemented so a native deployment can be compared
 * again without reopening the adapter.
 */
export const TIER_B_METRICS_QUERY_ID = "m3-tier-b-metrics-v2" as const;

export const TIER_B_METRICS_QUERY = `query M2TierBMetrics($pool: ID!) {
  ${META}
  pool(id: $pool) {
    id feeTier totalValueLockedUSD
    token0 { id symbol decimals }
    token1 { id symbol decimals }
  }
  poolDayDatas(
    first: 8
    orderBy: date
    orderDirection: desc
    where: { pool: $pool }
  ) { date volumeUSD feesUSD tvlUSD }
}`;
