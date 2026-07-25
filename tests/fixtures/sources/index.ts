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

// Point-in-time values from tests/integration/__evidence__/m2/*/07-common-metrics.json,
// with provenance updated to the active production query revision.
// 7d aggregates stay null here so Person 2 null-handling stays covered; M3.6 owns real 7d sums.

export const graphPoolA = {
  source_id: "uniswap-v3-base-native",
  source_type: "native_subgraph",
  protocol: "uniswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 30,
    tvl_usd: "150700095.7707237035076119974091172",
    volume_usd_24h: "1837918.971826772337839586279587621",
    volume_usd_7d: null,
    fees_usd_24h: "5513.756915480317013518758838762854",
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 49095773,
    indexed_block_timestamp: 1784980893,
    indexed_block_hash: "0xfaf4cc0493056e5ccac3f68b9e148cf8e80ee0d67adf333ed27b4a62d17c185c",
    queried_at: 1784980898,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR",
    schema_version: null,
    methodology_version: null,
    query_id: "m3-tier-b-metrics-v2",
  },
  warnings: ["Fixture retains null 7d aggregates; production 7d sums land in M3.6."],
  latency_ms: 120,
} satisfies PoolSourceResult;

export const graphPoolB = {
  source_id: "exchange-v3-base",
  source_type: "native_subgraph",
  protocol: "pancakeswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 1,
    tvl_usd: "6565424.026253424582404270532672039",
    volume_usd_24h: "6089724.592920848435197967898475142",
    volume_usd_7d: null,
    fees_usd_24h: "608.9724592920848435197967898475142",
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 49095784,
    indexed_block_timestamp: 1784980915,
    indexed_block_hash: "0x3d792f0e60742149c644825adb18c76fef43f01e25bc12dfef751de1e9d1bb6d",
    queried_at: 1784980920,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g",
    schema_version: null,
    methodology_version: null,
    query_id: "m3-tier-b-metrics-v2",
  },
  warnings: ["Fixture retains null 7d aggregates; production 7d sums land in M3.6."],
  latency_ms: 301,
} satisfies PoolSourceResult;

// Synthetic null-metric variant for Person 2 null paths. Not a third live Graph source.
export const graphPoolC = {
  source_id: "exchange-v3-base",
  source_type: "native_subgraph",
  protocol: "pancakeswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 1,
    tvl_usd: "6565424.026253424582404270532672039",
    volume_usd_24h: "6089724.592920848435197967898475142",
    volume_usd_7d: null,
    fees_usd_24h: null,
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 49095784,
    indexed_block_timestamp: 1784980915,
    indexed_block_hash: "0x3d792f0e60742149c644825adb18c76fef43f01e25bc12dfef751de1e9d1bb6d",
    queried_at: 1784980920,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g",
    schema_version: null,
    methodology_version: null,
    query_id: "m3-tier-b-metrics-v2",
  },
  warnings: ["Synthetic fixture: fees windows forced null for Person 2 null-handling coverage."],
  latency_ms: 301,
} satisfies PoolSourceResult;

// Synthetic timeout over real exchange-v3-base provenance (status flipped).
export const graphPoolCTimeout = {
  source_id: "exchange-v3-base",
  source_type: "native_subgraph",
  protocol: "pancakeswap-v3",
  chain_id: 8453,
  status: "timeout",
  data: null,
  freshness: null,
  provenance: {
    deployment_or_view_id: "QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g",
    schema_version: null,
    methodology_version: null,
    query_id: "m3-tier-b-metrics-v2",
  },
  warnings: ["Synthetic timeout over real exchange-v3-base provenance."],
  latency_ms: 15000,
} satisfies PoolSourceResult;

// Shape-only until M5 delivers live Nuthatch evidence. Pool matches Uniswap selection.
export const nuthatchFreshness = {
  source_id: "nuthatch-pool-swaps",
  source_type: "nuthatch_view",
  protocol: "uniswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
    recent_swap_count_24h: 321,
    last_swap_block: 49095770,
    last_swap_block_timestamp: 1784980887,
    last_swap_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    last_swap_tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    last_swap_log_index: 7,
  },
  freshness: {
    indexed_block: 49095770,
    indexed_block_timestamp: 1784980887,
    indexed_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    queried_at: 1784980925,
  },
  provenance: {
    deployment_or_view_id: "fixture-nuthatch-registry-hash",
    schema_version: null,
    methodology_version: null,
    query_id: "nuthatch-pool-swap-freshness-v1",
  },
  warnings: ["Shape-only Nuthatch fixture until M5 live evidence."],
  latency_ms: 42,
} satisfies NuthatchSourceResult;

// MVP-0 amended to two Graph sources + Nuthatch.
export const completeSourceScenario = [
  graphPoolA,
  graphPoolB,
  nuthatchFreshness,
] satisfies readonly MvpSourceFixture[];

export const partialSourceScenario = [
  graphPoolA,
  graphPoolCTimeout,
  nuthatchFreshness,
] satisfies readonly MvpSourceFixture[];
