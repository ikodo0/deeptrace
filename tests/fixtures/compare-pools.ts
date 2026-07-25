import type {
  CanonicalPair,
  ComparePoolsResponse,
  PoolComparisonRecord,
  ResultFreshness,
  ResultProvenance,
} from "../../src/schemas/index.js";

export const fixturePair = [
  {
    chain_id: 8453,
    address: "0x1111111111111111111111111111111111111111",
    symbol: "TOKEN-A",
    decimals: 18,
  },
  {
    chain_id: 8453,
    address: "0x2222222222222222222222222222222222222222",
    symbol: "TOKEN-B",
    decimals: 6,
  },
] as const satisfies CanonicalPair;

const graphSourceIds = ["fixture-dex-a", "fixture-dex-b"] as const;
const nuthatchSourceId = "fixture-nuthatch";

function graphProvenance(sourceId: string, protocol: string): ResultProvenance {
  return {
    source_id: sourceId,
    source_type: "native_subgraph",
    protocol,
    chain_id: 8453,
    deployment_or_view_id: `fixture-deployment-${sourceId}`,
    schema_version: null,
    methodology_version: "fixture-pool-metrics-v1",
    query_id: "fixture-pool-query-v1",
  };
}

const graphProvenanceEntries = [
  graphProvenance(graphSourceIds[0], "protocol-a"),
  graphProvenance(graphSourceIds[1], "protocol-b"),
] as const;

const nuthatchProvenance = {
  source_id: nuthatchSourceId,
  source_type: "nuthatch_view",
  protocol: "fixture-nuthatch",
  chain_id: 8453,
  deployment_or_view_id: "fixture-nuthatch-view",
  schema_version: "fixture-v1",
  methodology_version: "fixture-swap-freshness-v1",
  query_id: "fixture-nuthatch-query-v1",
} as const satisfies ResultProvenance;

function poolRecord(
  rank: number,
  sourceId: string,
  protocol: string,
  poolAddress: string,
  values: Pick<PoolComparisonRecord, "tvl_usd" | "volume_usd" | "fees_usd">,
): PoolComparisonRecord {
  return {
    chain_id: 8453,
    protocol,
    pool_address: poolAddress,
    pair: fixturePair,
    ...values,
    window: "24h",
    rank,
    source_ids: [sourceId],
  };
}

const completePools = [
  poolRecord(1, graphSourceIds[0], "protocol-a", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    tvl_usd: "1200000.50",
    volume_usd: "450000.25",
    fees_usd: "1350.75",
  }),
  poolRecord(2, graphSourceIds[1], "protocol-b", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
    tvl_usd: "900000",
    volume_usd: "300000",
    fees_usd: "0",
  }),
] as const;

function observedFreshness(
  sourceId: string,
  indexedBlock: number,
  lagSeconds: number,
  status: "fresh" | "stale" = "fresh",
): ResultFreshness {
  return {
    source_id: sourceId,
    status,
    indexed_block: indexedBlock,
    indexed_block_timestamp: 1_700_000_000 - lagSeconds,
    indexed_block_hash: null,
    queried_at: 1_700_000_000,
    lag_seconds: lagSeconds,
  };
}

const allProvenance = [...graphProvenanceEntries, nuthatchProvenance] as const;

export const completeComparePoolsFixture = {
  status: "complete",
  data: {
    chain_id: 8453,
    pair: fixturePair,
    window: "24h",
    ranked_by: "volume_usd",
    pools: completePools,
    nuthatch_freshness_fact: {
      pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      recent_swap_count_24h: 42,
      last_swap_block: 12_345_678,
      last_swap_block_timestamp: 1_700_000_000,
      source_id: nuthatchSourceId,
    },
  },
  coverage: {
    requested_deployments: 2,
    successful_deployments: 2,
    nuthatch_available: true,
  },
  freshness: [
    observedFreshness(graphSourceIds[0], 12_345_678, 12),
    observedFreshness(graphSourceIds[1], 12_345_670, 28),
    {
      ...observedFreshness(nuthatchSourceId, 12_345_678, 8),
      indexed_block_hash: `0x${"1".repeat(64)}`,
    },
  ],
  provenance: allProvenance,
  warnings: [],
  pagination: null,
  ai_reasoning: {
    status: "complete",
    summary: "Protocol A has the highest measured 24-hour volume.",
    highlights: ["Protocol A ranks first by source-reported volume."],
    caveats: [],
    source_ids: [graphSourceIds[0]],
  },
} as const satisfies ComparePoolsResponse;

export const partialComparePoolsFixture = {
  status: "partial",
  data: {
    chain_id: 8453,
    pair: fixturePair,
    window: "24h",
    ranked_by: "volume_usd",
    pools: [
      completePools[0],
      poolRecord(2, graphSourceIds[1], "protocol-b", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
        tvl_usd: "900000",
        volume_usd: null,
        fees_usd: "0",
      }),
    ],
    nuthatch_freshness_fact: null,
  },
  coverage: {
    requested_deployments: 2,
    successful_deployments: 2,
    nuthatch_available: false,
  },
  freshness: [
    observedFreshness(graphSourceIds[0], 12_345_678, 12),
    observedFreshness(graphSourceIds[1], 12_345_000, 600, "stale"),
    {
      source_id: nuthatchSourceId,
      status: "unavailable",
    },
  ],
  provenance: allProvenance,
  warnings: ["fixture-nuthatch was unavailable", "fixture-dex-b exceeded the freshness threshold"],
  pagination: null,
  ai_reasoning: {
    status: "unavailable",
    summary: "",
    highlights: [],
    caveats: [],
    source_ids: [],
  },
} as const satisfies ComparePoolsResponse;

export const failedComparePoolsFixture = {
  status: "failed",
  data: null,
  coverage: {
    requested_deployments: 2,
    successful_deployments: 0,
    nuthatch_available: false,
  },
  freshness: [
    ...graphSourceIds.map((sourceId) => ({
      source_id: sourceId,
      status: "unavailable" as const,
    })),
    {
      source_id: nuthatchSourceId,
      status: "unavailable",
    },
  ],
  provenance: allProvenance,
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

export const comparePoolsFixtures = [
  completeComparePoolsFixture,
  partialComparePoolsFixture,
  failedComparePoolsFixture,
] as const;
