import type { LendingMarketSourceResult } from "../../src/schemas/source-adapter.js";

export type LendingSourceFixture = LendingMarketSourceResult;

const usdc = {
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  symbol: "USDC",
  decimals: 6,
} as const;

// Point-in-time values captured from the three live Base lending deployments
// at block 49121431/49121432. Rates are percent APY exactly as reported.

/** Messari Aave v3 Base, USDC market. */
export const lendingAave = {
  source_id: "messari-aave-v3-base",
  source_type: "standardized_subgraph",
  protocol: "aave-v3",
  chain_id: 8453,
  status: "ok",
  data: {
    market_id: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
    market_name: "Aave Base USDC",
    input_token: usdc,
    is_active: true,
    can_borrow_from: true,
    can_use_as_collateral: false,
    tvl_usd: "172445303.026266003336",
    total_deposit_balance_usd: "172445303.026266003336",
    total_borrow_balance_usd: "152467572.25396482662232",
    lender_variable_rate_percent: "3.5177249578887369",
    borrower_variable_rate_percent: "4.4207374872837901",
    borrower_stable_rate_percent: "0",
  },
  freshness: {
    indexed_block: 49121431,
    indexed_block_timestamp: 1785032209,
    indexed_block_hash: "0xa39b13862e2eb5f1f904c19c2e88fb5d82f9ee9f5352fd9f108a18e69247fbb1",
    queried_at: 1785032214,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
    schema_version: "3.1.0",
    methodology_version: "1.1.0",
    query_id: "tier-a-lending-market-metrics-v1",
  },
  warnings: [],
  latency_ms: 140,
} satisfies LendingMarketSourceResult;

/** Messari Seamless Base, USDC market. The live market is flagged inactive. */
export const lendingSeamless = {
  source_id: "messari-seamless-base",
  source_type: "standardized_subgraph",
  protocol: "seamless-protocol",
  chain_id: 8453,
  status: "ok",
  data: {
    market_id: "0x53e240c0f985175da046a62f26d490d1e259036e",
    market_name: "Seamless USDC",
    input_token: usdc,
    is_active: false,
    can_borrow_from: true,
    can_use_as_collateral: false,
    tvl_usd: "205400.2928784070077",
    total_deposit_balance_usd: "205400.2928784070077",
    total_borrow_balance_usd: "24150.82687434733677",
    lender_variable_rate_percent: "0.1106243693385229",
    borrower_variable_rate_percent: "1.0452685606279676",
    borrower_stable_rate_percent: "8",
  },
  freshness: {
    indexed_block: 49121431,
    indexed_block_timestamp: 1785032209,
    indexed_block_hash: "0xa39b13862e2eb5f1f904c19c2e88fb5d82f9ee9f5352fd9f108a18e69247fbb1",
    queried_at: 1785032214,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmPSmTkJPSKLFn46YdgwMKV5K2c9a3pkWnzDCC4ccCLAXE",
    schema_version: "3.1.0",
    methodology_version: "1.0.0",
    query_id: "tier-a-lending-market-metrics-v1",
  },
  warnings: [
    "messari-seamless-base market 0x53e240c0f985175da046a62f26d490d1e259036e is reported as inactive.",
  ],
  latency_ms: 155,
} satisfies LendingMarketSourceResult;

/** Messari Moonwell Base, USDC market. Moonwell publishes no stable rate. */
export const lendingMoonwell = {
  source_id: "messari-moonwell-base",
  source_type: "standardized_subgraph",
  protocol: "moonwell",
  chain_id: 8453,
  status: "ok",
  data: {
    market_id: "0xedc817a28e8b93b03976fbd4a3ddbc9f7d176c22",
    market_name: "Moonwell USDC",
    input_token: usdc,
    is_active: true,
    can_borrow_from: true,
    can_use_as_collateral: true,
    tvl_usd: "15066697.09797739573995",
    total_deposit_balance_usd: "15066697.09797739573995",
    total_borrow_balance_usd: "13154949.96727053476238",
    lender_variable_rate_percent: "4.1165790985584",
    borrower_variable_rate_percent: "5.2386888310416",
    borrower_stable_rate_percent: null,
  },
  freshness: {
    indexed_block: 49121432,
    indexed_block_timestamp: 1785032211,
    indexed_block_hash: "0xeaa3038aa8c4bf926ffef0ae5e1c5bbd37007b6b23d2da97918160de41a37ad1",
    queried_at: 1785032214,
    has_indexing_errors: false,
  },
  provenance: {
    deployment_or_view_id: "QmeE6TgfRmK2iLAgCLBeXuxJQ2VXLFAeHVMTvmnECiFw7y",
    schema_version: "2.0.1",
    methodology_version: "1.0.0",
    query_id: "tier-a-lending-market-metrics-v1",
  },
  warnings: [],
  latency_ms: 210,
} satisfies LendingMarketSourceResult;

/** Synthetic timeout over the real Seamless provenance (status flipped). */
export const lendingSeamlessTimeout = {
  source_id: lendingSeamless.source_id,
  source_type: lendingSeamless.source_type,
  protocol: lendingSeamless.protocol,
  chain_id: lendingSeamless.chain_id,
  status: "timeout",
  data: null,
  freshness: null,
  provenance: lendingSeamless.provenance,
  warnings: [`Synthetic timeout over real ${lendingSeamless.source_id} provenance.`],
  latency_ms: 8000,
} satisfies LendingMarketSourceResult;

/** Synthetic unsupported over the real Moonwell provenance (status flipped). */
export const lendingMoonwellUnsupported = {
  source_id: lendingMoonwell.source_id,
  source_type: lendingMoonwell.source_type,
  protocol: lendingMoonwell.protocol,
  chain_id: lendingMoonwell.chain_id,
  status: "unsupported",
  data: null,
  freshness: null,
  provenance: lendingMoonwell.provenance,
  warnings: [`Synthetic unsupported over real ${lendingMoonwell.source_id} provenance.`],
  latency_ms: 95,
} satisfies LendingMarketSourceResult;

/** All three protocols answered with fresh data. */
export const completeLendingScenario = [
  lendingAave,
  lendingSeamless,
  lendingMoonwell,
] satisfies readonly LendingSourceFixture[];

/** One protocol answered; the other two degraded. */
export const partialLendingScenario = [
  lendingAave,
  lendingSeamlessTimeout,
  lendingMoonwellUnsupported,
] satisfies readonly LendingSourceFixture[];
