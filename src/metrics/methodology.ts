import { M0_RANKING_TIE_BREAK } from "../policy/index.js";

/**
 * MVP-0 compare_pools metric methodology for source-reported USD values.
 *
 * H4 handoff (primary-owned): DeepTrace does not reprice, average across
 * sources, or label fee-to-TVL ratios as APR/APY.
 */
export const M0_POOL_METRICS_METHODOLOGY = {
  id: "compare-pools-source-reported-usd-v1",
  unit: "usd",
  window_methodology: "completed-utc-days-v1",
  tvl_usd: {
    selection: "source_reported_tvl_usd_passthrough",
    description: "Pass through the Graph-reported pool TVL USD decimal string or null.",
  },
  volume_usd: {
    selection: "source_reported_window_volume_usd_passthrough",
    description:
      "Pass through the selected completed-UTC-day window volume USD decimal string or null.",
  },
  fees_usd: {
    selection: "source_reported_window_total_revenue_usd_passthrough",
    description:
      "Pass through the selected completed-UTC-day window fee revenue USD decimal string or null. The Messari dex-amm standard has no per-day fee field, so this is dailyTotalRevenueUSD: supply-side plus protocol-side revenue accrued that day. On the compared Uniswap V3 Base pools the protocol-side share is zero, so the value equals LP fees, but that is a property of those pools and not a conversion DeepTrace performs.",
  },
  ranking: {
    tie_break: M0_RANKING_TIE_BREAK,
  },
  /** Explicit non-goals for MVP-0. */
  non_goals: ["apr", "apy", "fee_to_tvl_ratio_as_yield"] as const,
} as const;

export type M0PoolMetricsMethodology = typeof M0_POOL_METRICS_METHODOLOGY;
