import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Locked MVP-0 compare_pools allowlist for Graph-side binding.
 *
 * Values mirror `src/registry/compare-pools.json` and `records.json`.
 * The Nuthatch source ID resolves the active registry-pinned freshness view.
 */
export const M0_COMPARE_POOLS_SCOPE = {
  chainId: BASE_CHAIN_ID,
  token0: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: 18,
  },
  token1: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
  },
  graphSources: [
    {
      source_id: "uniswap-v3-base-native",
      protocol: "uniswap-v3",
      pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
      query_id: "m3-tier-b-metrics-v2",
      deployment_or_view_id: "QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR",
    },
    {
      source_id: "exchange-v3-base",
      protocol: "pancakeswap-v3",
      pool_address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
      query_id: "m3-tier-b-metrics-v2",
      deployment_or_view_id: "QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g",
    },
  ],
  /** Active registry-pinned source for the Nuthatch freshness fact. */
  nuthatchSourceId: "nuthatch-pool-swaps",
} as const;

export type M0ComparePoolsScope = typeof M0_COMPARE_POOLS_SCOPE;
