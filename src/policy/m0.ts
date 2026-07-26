import { GATEWAY_DEFAULTS, GATEWAY_MAXIMUMS } from "../config/defaults.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

export const M0_TIME_WINDOWS = ["24h", "7d"] as const;
export type M0TimeWindow = (typeof M0_TIME_WINDOWS)[number];

export const M0_RANKING_METRICS = ["tvl_usd", "volume_usd", "fees_usd"] as const;
export type M0RankingMetric = (typeof M0_RANKING_METRICS)[number];

export const M0_LENDING_RANKING_METRICS = [
  "tvl_usd",
  "total_deposit_balance_usd",
  "total_borrow_balance_usd",
  "lender_variable_rate_percent",
  "borrower_variable_rate_percent",
] as const;
export type M0LendingRankingMetric = (typeof M0_LENDING_RANKING_METRICS)[number];

export const M0_RANKING_TIE_BREAK = [
  "requested_metric_desc_nulls_last",
  "protocol_asc",
  "pool_address_asc",
  "source_id_asc",
] as const;

export const M0_WARNING_ORDER = ["source_order", "warning_text"] as const;

/**
 * Product limits and deterministic behavior locked by M0-01A.
 *
 * Live pair and deployment binding lands in M0-02B (`src/scope/compare-pools.ts`).
 * A verified Nuthatch freshness fact remains outstanding and must not be invented.
 */
export const M0_CORE_POLICY = {
  chainId: BASE_CHAIN_ID,
  defaultWindow: "24h" satisfies M0TimeWindow,
  defaultRankingMetric: "volume_usd" satisfies M0RankingMetric,
  topN: {
    default: 3,
    maximum: 3,
  },
  gateway: {
    rateLimit: {
      defaultMaxRequests: GATEWAY_DEFAULTS.rateLimitMaxRequests,
      maximumMaxRequests: GATEWAY_MAXIMUMS.rateLimitMaxRequests,
      defaultWindowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      maximumWindowMs: GATEWAY_MAXIMUMS.rateLimitWindowMs,
      resetPolicy: "fixed_window",
    },
    sourceTimeoutMs: GATEWAY_DEFAULTS.sourceTimeoutMs,
    maximumSourceTimeoutMs: GATEWAY_MAXIMUMS.sourceTimeoutMs,
    endToEndTimeoutMs: 15_000,
    maximumResponseBytes: 65_536,
  },
  freshness: {
    qualityStaleAfterSeconds: 300,
    enforcementLayer: "core_quality",
    preservesAdapterStatus: true,
  },
  coverage: {
    /** Two WETH/USDC fee-tier pools, both served by one Messari deployment. */
    expectedGraphResults: 2,
    requiresNuthatchForComplete: true,
    minimumGraphResultsForPartial: 1,
  },
  /**
   * `compare_lending_markets` compares one asset across every selected
   * protocol, so the market token is locked rather than requested.
   */
  lending: {
    marketToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    defaultRankingMetric: "tvl_usd" satisfies M0LendingRankingMetric,
    topN: {
      default: 3,
      maximum: 3,
    },
    coverage: {
      expectedSources: 3,
      minimumSourcesForPartial: 1,
    },
  },
} as const;
