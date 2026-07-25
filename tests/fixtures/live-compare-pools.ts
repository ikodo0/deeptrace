import type { CanonicalPair, ComparePoolsResponse } from "../../src/schemas/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import { graphPoolA, graphPoolB, graphPoolCTimeout } from "./sources/index.js";

/**
 * Live-derived compare_pools response fixtures for Graph-only M0-02B.
 * Nuthatch remains explicitly unavailable — no invented live freshness fact.
 */

const livePair = [
  {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    address: M0_COMPARE_POOLS_SCOPE.token0.address,
    symbol: M0_COMPARE_POOLS_SCOPE.token0.symbol,
    decimals: M0_COMPARE_POOLS_SCOPE.token0.decimals,
  },
  {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    address: M0_COMPARE_POOLS_SCOPE.token1.address,
    symbol: M0_COMPARE_POOLS_SCOPE.token1.symbol,
    decimals: M0_COMPARE_POOLS_SCOPE.token1.decimals,
  },
] as const satisfies CanonicalPair;

const [uniswap, pancake] = M0_COMPARE_POOLS_SCOPE.graphSources;
const nuthatchId = M0_COMPARE_POOLS_SCOPE.nuthatchSourceId;

const uniswapProvenance = {
  source_id: uniswap.source_id,
  source_type: "native_subgraph" as const,
  protocol: uniswap.protocol,
  chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
  deployment_or_view_id: uniswap.deployment_or_view_id,
  schema_version: null,
  methodology_version: null,
  query_id: uniswap.query_id,
};

const pancakeProvenance = {
  source_id: pancake.source_id,
  source_type: "native_subgraph" as const,
  protocol: pancake.protocol,
  chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
  deployment_or_view_id: pancake.deployment_or_view_id,
  schema_version: null,
  methodology_version: null,
  query_id: pancake.query_id,
};

const nuthatchProvenance = {
  source_id: nuthatchId,
  source_type: "nuthatch_view" as const,
  protocol: "uniswap-v3",
  chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
  deployment_or_view_id: "unverified-nuthatch-view",
  schema_version: null,
  methodology_version: null,
  query_id: "nuthatch-pool-swap-freshness-v1",
};

const liveProvenance = [uniswapProvenance, pancakeProvenance, nuthatchProvenance] as const;

function graphFreshness(
  result: typeof graphPoolA,
  lagSeconds: number,
  status: "fresh" | "stale" = "fresh",
) {
  return {
    source_id: result.source_id,
    status,
    indexed_block: result.freshness.indexed_block,
    indexed_block_timestamp: result.freshness.queried_at - lagSeconds,
    indexed_block_hash: result.freshness.indexed_block_hash ?? null,
    queried_at: result.freshness.queried_at,
    lag_seconds: lagSeconds,
  };
}

/** Both Graph sources observed; Nuthatch explicitly missing → partial. */
export const livePartialComparePoolsFixture = {
  status: "partial",
  data: {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    pair: livePair,
    window: "24h",
    ranked_by: "volume_usd",
    pools: [
      {
        chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
        protocol: pancake.protocol,
        pool_address: pancake.pool_address,
        pair: livePair,
        tvl_usd: graphPoolB.data.tvl_usd,
        volume_usd: graphPoolB.data.volume_usd_24h,
        fees_usd: graphPoolB.data.fees_usd_24h,
        window: "24h",
        rank: 1,
        source_ids: [pancake.source_id],
      },
      {
        chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
        protocol: uniswap.protocol,
        pool_address: uniswap.pool_address,
        pair: livePair,
        tvl_usd: graphPoolA.data.tvl_usd,
        volume_usd: graphPoolA.data.volume_usd_24h,
        fees_usd: graphPoolA.data.fees_usd_24h,
        window: "24h",
        rank: 2,
        source_ids: [uniswap.source_id],
      },
    ],
    nuthatch_freshness_fact: null,
  },
  coverage: {
    requested_deployments: 2,
    successful_deployments: 2,
    nuthatch_available: false,
  },
  freshness: [
    graphFreshness(graphPoolA, 5),
    graphFreshness(graphPoolB, 5),
    { source_id: nuthatchId, status: "unavailable" },
  ],
  provenance: liveProvenance,
  warnings: ["nuthatch-pool-swaps live freshness fact is not yet verified"],
  pagination: null,
  ai_reasoning: {
    status: "unavailable",
    summary: "",
    highlights: [],
    caveats: [],
    source_ids: [],
  },
} as const satisfies ComparePoolsResponse;

/** One Graph timeout + one Graph ok; Nuthatch unavailable. */
export const livePartialOneGraphTimeoutFixture = {
  status: "partial",
  data: {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    pair: livePair,
    window: "24h",
    ranked_by: "volume_usd",
    pools: [
      {
        chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
        protocol: uniswap.protocol,
        pool_address: uniswap.pool_address,
        pair: livePair,
        tvl_usd: graphPoolA.data.tvl_usd,
        volume_usd: graphPoolA.data.volume_usd_24h,
        fees_usd: graphPoolA.data.fees_usd_24h,
        window: "24h",
        rank: 1,
        source_ids: [uniswap.source_id],
      },
    ],
    nuthatch_freshness_fact: null,
  },
  coverage: {
    requested_deployments: 2,
    successful_deployments: 1,
    nuthatch_available: false,
  },
  freshness: [
    graphFreshness(graphPoolA, 5),
    { source_id: pancake.source_id, status: "unavailable" },
    { source_id: nuthatchId, status: "unavailable" },
  ],
  provenance: liveProvenance,
  warnings: [
    `${graphPoolCTimeout.source_id} timed out`,
    "nuthatch-pool-swaps live freshness fact is not yet verified",
  ],
  pagination: null,
  ai_reasoning: {
    status: "unavailable",
    summary: "",
    highlights: [],
    caveats: [],
    source_ids: [],
  },
} as const satisfies ComparePoolsResponse;

/** All Graph sources unavailable; Nuthatch unavailable. */
export const liveFailedComparePoolsFixture = {
  status: "failed",
  data: null,
  coverage: {
    requested_deployments: 2,
    successful_deployments: 0,
    nuthatch_available: false,
  },
  freshness: [
    { source_id: uniswap.source_id, status: "unavailable" },
    { source_id: pancake.source_id, status: "unavailable" },
    { source_id: nuthatchId, status: "unavailable" },
  ],
  provenance: liveProvenance,
  warnings: ["No valid Graph pool record was available"],
  pagination: null,
  ai_reasoning: {
    status: "unavailable",
    summary: "",
    highlights: [],
    caveats: [],
    source_ids: [],
  },
} as const satisfies ComparePoolsResponse;

/** Stale Graph freshness with missing Nuthatch. */
export const liveStaleGraphComparePoolsFixture = {
  status: "partial",
  data: {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    pair: livePair,
    window: "24h",
    ranked_by: "volume_usd",
    pools: [
      {
        chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
        protocol: uniswap.protocol,
        pool_address: uniswap.pool_address,
        pair: livePair,
        tvl_usd: graphPoolA.data.tvl_usd,
        volume_usd: graphPoolA.data.volume_usd_24h,
        fees_usd: null,
        window: "24h",
        rank: 1,
        source_ids: [uniswap.source_id],
      },
    ],
    nuthatch_freshness_fact: null,
  },
  coverage: {
    requested_deployments: 2,
    successful_deployments: 1,
    nuthatch_available: false,
  },
  freshness: [
    graphFreshness(graphPoolA, 600, "stale"),
    { source_id: pancake.source_id, status: "unavailable" },
    { source_id: nuthatchId, status: "unavailable" },
  ],
  provenance: liveProvenance,
  warnings: [
    `${uniswap.source_id} exceeded the freshness threshold`,
    `${pancake.source_id} was unavailable`,
    "nuthatch-pool-swaps live freshness fact is not yet verified",
  ],
  pagination: null,
  ai_reasoning: {
    status: "unavailable",
    summary: "",
    highlights: [],
    caveats: [],
    source_ids: [],
  },
} as const satisfies ComparePoolsResponse;

export const liveComparePoolsFixtures = [
  livePartialComparePoolsFixture,
  livePartialOneGraphTimeoutFixture,
  liveFailedComparePoolsFixture,
  liveStaleGraphComparePoolsFixture,
] as const;
