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
    selection: "source_reported_window_fees_usd_passthrough",
    description:
      "Pass through the selected completed-UTC-day window fees USD decimal string or null.",
  },
  ranking: {
    tie_break: [
      "requested_metric_desc_nulls_last",
      "protocol_asc",
      "pool_address_asc",
      "source_id_asc",
    ],
  },
  /** Explicit non-goals for MVP-0. */
  non_goals: ["apr", "apy", "fee_to_tvl_ratio_as_yield"] as const,
} as const;

export type M0PoolMetricsMethodology = typeof M0_POOL_METRICS_METHODOLOGY;
