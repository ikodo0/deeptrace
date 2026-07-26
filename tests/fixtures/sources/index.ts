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

// Point-in-time values from tests/integration/__evidence__/m3/*/01-pool-metrics.json.
// 24h values are the newest completed UTC day in that capture; 7d aggregates stay
// null here so null-handling paths stay covered without pinning a seven-day sum.

/** Messari Uniswap V3 Base, 0.3% WETH/USDC tier. */
export const graphPoolA = {
  source_id: "messari-uniswap-v3-base-fee030",
  source_type: "standardized_subgraph",
  protocol: "uniswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 30,
    tvl_usd: "114861166.2464289945430831254042441",
    volume_usd_24h: "7784090.37607948122807978670587",
    volume_usd_7d: null,
    fees_usd_24h: "23352.27112823844368423936011761",
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 49121447,
    indexed_block_timestamp: 1785032241,
    indexed_block_hash: "0x4c8d9676350cd7754f7eb2a1f2eb8cab1660889c2a141be4a4f6905cc23dd54e",
    queried_at: 1785032246,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh",
    schema_version: "4.0.1",
    methodology_version: "1.0.0",
    query_id: "tier-a-dex-pool-metrics-v1",
  },
  warnings: ["Fixture retains null 7d aggregates; live 7d sums come from the adapter."],
  latency_ms: 120,
} satisfies PoolSourceResult;

/** Messari Uniswap V3 Base, 0.05% WETH/USDC tier. */
export const graphPoolB = {
  source_id: "messari-uniswap-v3-base-fee005",
  source_type: "standardized_subgraph",
  protocol: "uniswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0xd0b53d9277642d899df5c87a3966a349a798f224",
    token0: weth,
    token1: usdc,
    fee_tier_bps: 5,
    tvl_usd: "10637748.34455860477744937575922415",
    volume_usd_24h: "2957180.60438499663534225066392",
    volume_usd_7d: null,
    fees_usd_24h: "1478.59030219249831767112534419",
    fees_usd_7d: null,
  },
  freshness: {
    indexed_block: 49121448,
    indexed_block_timestamp: 1785032243,
    indexed_block_hash: "0xe60c2ae734e634f8260a56b337c9a8c233b36c9a361fb53fcf727e680a2d1855",
    queried_at: 1785032248,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh",
    schema_version: "4.0.1",
    methodology_version: "1.0.0",
    query_id: "tier-a-dex-pool-metrics-v1",
  },
  warnings: ["Fixture retains null 7d aggregates; live 7d sums come from the adapter."],
  latency_ms: 301,
} satisfies PoolSourceResult;

// Synthetic null-metric variant over the 0.05% tier's real identity.
export const graphPoolC = {
  ...graphPoolB,
  data: {
    ...graphPoolB.data,
    fees_usd_24h: null,
  },
  warnings: ["Synthetic fixture: fees windows forced null for null-handling coverage."],
} satisfies PoolSourceResult;

// Synthetic timeout over the 0.05% tier's real provenance (status flipped).
export const graphPoolCTimeout = {
  source_id: graphPoolB.source_id,
  source_type: graphPoolB.source_type,
  protocol: graphPoolB.protocol,
  chain_id: graphPoolB.chain_id,
  status: "timeout",
  data: null,
  freshness: null,
  provenance: graphPoolB.provenance,
  warnings: [`Synthetic timeout over real ${graphPoolB.source_id} provenance.`],
  latency_ms: 15000,
} satisfies PoolSourceResult;

// Shape-only until live Nuthatch evidence lands. Pool matches the 0.3% selection.
export const nuthatchFreshness = {
  source_id: "nuthatch-pool-swaps",
  source_type: "nuthatch_view",
  protocol: "uniswap-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
    recent_swap_count_24h: 321,
    last_swap_block: 49121440,
    last_swap_block_timestamp: 1785032227,
    last_swap_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    last_swap_tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    last_swap_log_index: 7,
  },
  freshness: {
    indexed_block: 49121440,
    indexed_block_timestamp: 1785032227,
    indexed_block_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    queried_at: 1785032250,
  },
  provenance: {
    deployment_or_view_id: "fixture-nuthatch-registry-hash",
    schema_version: null,
    methodology_version: null,
    query_id: "nuthatch-pool-swap-freshness-v1",
  },
  warnings: ["Shape-only Nuthatch fixture until live evidence."],
  latency_ms: 42,
} satisfies NuthatchSourceResult;

// Two Messari Graph fee tiers + Nuthatch.
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
