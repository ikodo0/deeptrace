import { GATEWAY_DEFAULTS, GATEWAY_MAXIMUMS } from "../config/defaults.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

export const M0_TIME_WINDOWS = ["24h", "7d"] as const;
export type M0TimeWindow = (typeof M0_TIME_WINDOWS)[number];

export const M0_RANKING_METRICS = ["tvl_usd", "volume_usd", "fees_usd"] as const;
export type M0RankingMetric = (typeof M0_RANKING_METRICS)[number];

export const M0_RANKING_TIE_BREAK = [
  "requested_metric_desc_nulls_last",
  "protocol_asc",
  "pool_address_asc",
  "source_id_asc",
] as const;

export const M0_WARNING_ORDER = ["source_order", "warning_code", "source_id"] as const;

/**
 * Product limits and deterministic behavior locked by M0-01A.
 *
 * Live pair, deployment, and Nuthatch selections belong to M0-01B and are
 * intentionally absent.
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
    staleAfterSeconds: 300,
  },
  coverage: {
    expectedGraphResults: 3,
    requiresNuthatchForComplete: true,
    minimumGraphResultsForPartial: 1,
  },
  reasoning: {
    maximumProviderAttempts: 2,
    providerAttemptTimeoutMs: 2_000,
    totalTimeoutMs: 5_000,
    maximumInputBytes: 32_768,
    maximumOutputBytes: 8_192,
    maximumHighlights: 5,
    maximumCaveats: 5,
  },
} as const;
