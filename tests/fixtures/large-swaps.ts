import type {
  FindLargeSwapsResponse,
  ResultFreshness,
  ResultProvenance,
  SwapEvent,
} from "../../src/schemas/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";

const sourceId = "fixture-nuthatch-swaps";

const weth = {
  chain_id: LSS_SCOPE.chainId,
  ...LSS_SCOPE.tokens.weth,
} as const;

const usdc = {
  chain_id: LSS_SCOPE.chainId,
  ...LSS_SCOPE.tokens.usdc,
} as const;

const provenance = {
  source_id: sourceId,
  source_type: "nuthatch_view",
  protocol: LSS_SCOPE.protocol,
  chain_id: LSS_SCOPE.chainId,
  deployment_or_view_id: "fixture-swap-search-view",
  schema_version: "fixture-v1",
  methodology_version: "fixture-swap-normalization-v1",
  query_id: "fixture-large-swaps-query-v1",
} as const satisfies ResultProvenance;

const fresh = {
  source_id: sourceId,
  status: "fresh",
  indexed_block: 20_000_100,
  indexed_block_timestamp: 1_750_000_000,
  indexed_block_hash: `0x${"a".repeat(64)}`,
  queried_at: 1_750_000_020,
  lag_seconds: 20,
} as const satisfies ResultFreshness;

export const wethToUsdcSwapFixture = {
  chain_id: LSS_SCOPE.chainId,
  protocol: LSS_SCOPE.protocol,
  pool: LSS_SCOPE.poolAddress,
  transaction_hash: `0x${"1".repeat(64)}`,
  log_index: 12,
  block_number: 20_000_099,
  timestamp: 1_749_999_990,
  asset_in: weth,
  asset_out: usdc,
  amount_in: "2.5",
  amount_out: "6250.125",
  amount_in_raw: "2500000000000000000",
  amount_out_raw: "-6250125000",
  usd_notional: null,
  source_id: sourceId,
} satisfies SwapEvent;

export const usdcToWethSwapFixture = {
  chain_id: LSS_SCOPE.chainId,
  protocol: LSS_SCOPE.protocol,
  pool: LSS_SCOPE.poolAddress,
  transaction_hash: `0x${"2".repeat(64)}`,
  log_index: 7,
  block_number: 20_000_098,
  timestamp: 1_749_999_980,
  asset_in: usdc,
  asset_out: weth,
  amount_in: "3000.000001",
  amount_out: "1.2",
  amount_in_raw: "3000000001",
  amount_out_raw: "-1200000000000000000",
  usd_notional: null,
  source_id: sourceId,
} satisfies SwapEvent;

const quality: Pick<
  Extract<FindLargeSwapsResponse, { status: "complete" }>,
  "coverage" | "freshness" | "provenance" | "warnings"
> = {
  coverage: {
    requested_sources: 1,
    successful_sources: 1,
  },
  freshness: [fresh],
  provenance: [provenance],
  warnings: [],
};

export const completeLargeSwapsFixture = {
  status: "complete",
  data: {
    chain_id: LSS_SCOPE.chainId,
    pool_address: LSS_SCOPE.poolAddress,
    threshold_token: LSS_SCOPE.tokens.weth.address,
    min_amount: "1.5",
    swaps: [wethToUsdcSwapFixture, usdcToWethSwapFixture],
  },
  ...quality,
  pagination: {
    limit: 25,
    returned: 2,
    has_more: false,
    next_cursor: null,
  },
} satisfies FindLargeSwapsResponse;

export const emptyLargeSwapsFixture = {
  status: "complete",
  data: {
    chain_id: LSS_SCOPE.chainId,
    pool_address: LSS_SCOPE.poolAddress,
    threshold_token: LSS_SCOPE.tokens.weth.address,
    min_amount: "1000000",
    swaps: [],
  },
  ...quality,
  pagination: {
    limit: 25,
    returned: 0,
    has_more: false,
    next_cursor: null,
  },
} satisfies FindLargeSwapsResponse;

export const paginatedLargeSwapsFixture = {
  status: "complete",
  data: {
    chain_id: LSS_SCOPE.chainId,
    pool_address: LSS_SCOPE.poolAddress,
    threshold_token: LSS_SCOPE.tokens.usdc.address,
    min_amount: "2500",
    swaps: [usdcToWethSwapFixture],
  },
  ...quality,
  pagination: {
    limit: 1,
    returned: 1,
    has_more: true,
    next_cursor: "lss:v1:fixture-page-2",
  },
} satisfies FindLargeSwapsResponse;

export const failedSourceLargeSwapsFixture = {
  status: "failed",
  data: null,
  coverage: {
    requested_sources: 1,
    successful_sources: 0,
  },
  freshness: [
    {
      source_id: sourceId,
      status: "unavailable",
    },
  ],
  provenance: [provenance],
  warnings: ["fixture-nuthatch-swaps was unavailable"],
  pagination: {
    limit: 25,
    returned: 0,
    has_more: false,
    next_cursor: null,
  },
} satisfies FindLargeSwapsResponse;

/**
 * Intentionally invalid canonical page used to prove duplicate identity rejection.
 */
export const duplicateLargeSwapsFixture = {
  ...completeLargeSwapsFixture,
  data: {
    ...completeLargeSwapsFixture.data,
    swaps: [wethToUsdcSwapFixture, { ...wethToUsdcSwapFixture }],
  },
} satisfies FindLargeSwapsResponse;

export const validLargeSwapsFixtures = [
  completeLargeSwapsFixture,
  emptyLargeSwapsFixture,
  paginatedLargeSwapsFixture,
  failedSourceLargeSwapsFixture,
] as const;
