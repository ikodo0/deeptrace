/**
 * Locked Tier-B metrics query for MVP-0 compare_pools Graph sources.
 * Identity must stay aligned with the production compare-pools profile.
 */
export const TIER_B_METRICS_QUERY_ID = "m3-tier-b-metrics-v2" as const;

export const TIER_B_METRICS_QUERY = `query M2TierBMetrics($pool: ID!) {
  _meta {
    block { number timestamp hash }
    hasIndexingErrors
    deployment
  }
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
