import type {
  NuthatchSourceResult,
  PoolSourceResult,
} from "../../../src/schemas/source-adapter.js";

export type PoolSourceFixture = PoolSourceResult;
export type NuthatchSourceFixture = NuthatchSourceResult;
export type MvpSourceFixture = PoolSourceFixture | NuthatchSourceFixture;

const weth = {
  address: "0x4200000000000000000000000000000000000006",
  symbol: "WETH",
  decimals: 18,
} as const;

const usdc = {
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  symbol: "USDC",
  decimals: 6,
} as const;

export const graphPoolA = {
  source_id: "fixture-graph-dex-a",
  source_type: "standardized_subgraph",
  protocol: "fixture-dex-a",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x00000000000000000000000000000000000000a1",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 5,
    tvl_usd: "1250000.25",
    volume_usd_24h: "250000.50",
    volume_usd_7d: "1750000.75",
    fees_usd_24h: "125.00",
    fees_usd_7d: "875.00",
  },
  freshness: {
    indexed_block: 30000001,
    indexed_block_timestamp: 1735689601,
    queried_at: 1735689610,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "fixture-deployment-a",
    schema_version: "fixture-1.0.0",
    methodology_version: "fixture-1.0.0",
    query_id: "fixture-pool-metrics-v1",
  },
  warnings: [],
  latency_ms: 101,
} satisfies PoolSourceResult;

export const graphPoolB = {
  source_id: "fixture-graph-dex-b",
  source_type: "standardized_subgraph",
  protocol: "fixture-dex-b",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x00000000000000000000000000000000000000b2",
    token0: usdc,
    token1: weth,
    fee_tier_bps: 30,
    tvl_usd: "980000.00",
    volume_usd_24h: "310000.10",
    volume_usd_7d: "2010000.20",
    fees_usd_24h: "930.00",
    fees_usd_7d: "6030.00",
  },
  freshness: {
    indexed_block: 30000002,
    indexed_block_timestamp: 1735689603,
    queried_at: 1735689611,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "fixture-deployment-b",
    schema_version: "fixture-1.0.0",
    methodology_version: "fixture-1.0.0",
    query_id: "fixture-pool-metrics-v1",
  },
  warnings: [],
  latency_ms: 114,
} satisfies PoolSourceResult;

export const graphPoolC = {
  source_id: "fixture-graph-dex-c",
  source_type: "standardized_subgraph",
  protocol: "fixture-dex-c",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x00000000000000000000000000000000000000c3",
    token0: weth,
    token1: usdc,
    fee_tier_bps: null,
    tvl_usd: "720000.40",
    volume_usd_24h: "190000.30",
    volume_usd_7d: null,
    fees_usd_24h: "570.00",
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 30000000,
    indexed_block_timestamp: 1735689599,
    queried_at: 1735689612,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "fixture-deployment-c",
    schema_version: "fixture-1.0.0",
    methodology_version: null,
    query_id: "fixture-pool-metrics-v1",
  },
  warnings: ["Fixture source does not expose seven-day aggregates."],
  latency_ms: 98,
} satisfies PoolSourceResult;

export const graphPoolCTimeout = {
  source_id: "fixture-graph-dex-c",
  source_type: "standardized_subgraph",
  protocol: "fixture-dex-c",
  chain_id: 8453,
  status: "timeout",
  data: null,
  freshness: null,
  provenance: {
    deployment_or_view_id: "fixture-deployment-c",
    schema_version: "fixture-1.0.0",
    methodology_version: null,
    query_id: "fixture-pool-metrics-v1",
  },
  warnings: ["Fixture source timed out before returning data."],
  latency_ms: 5000,
} satisfies PoolSourceResult;

export const nuthatchFreshness = {
  source_id: "fixture-nuthatch-pool-swaps",
  source_type: "nuthatch_view",
  protocol: "fixture-dex-a",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x00000000000000000000000000000000000000a1",
    recent_swap_count_24h: 321,
    last_swap_block: 30000003,
    last_swap_block_timestamp: 1735689605,
    last_swap_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    last_swap_tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    last_swap_log_index: 7,
  },
  freshness: {
    indexed_block: 30000003,
    indexed_block_timestamp: 1735689605,
    indexed_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    queried_at: 1735689613,
  },
  provenance: {
    deployment_or_view_id: "fixture-nuthatch-registry-hash",
    schema_version: "fixture-1.0.0",
    methodology_version: "fixture-1.0.0",
    query_id: "fixture-pool-swap-freshness-v1",
  },
  warnings: [],
  latency_ms: 42,
} satisfies NuthatchSourceResult;

export const completeSourceScenario = [
  graphPoolA,
  graphPoolB,
  graphPoolC,
  nuthatchFreshness,
] satisfies readonly MvpSourceFixture[];

export const partialSourceScenario = [
  graphPoolA,
  graphPoolB,
  graphPoolCTimeout,
  nuthatchFreshness,
] satisfies readonly MvpSourceFixture[];
