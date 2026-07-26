import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Locked compare_pools allowlist for Graph-side binding.
 *
 * Both Graph sources read the same Messari `dex-amm` standardized deployment;
 * they differ only in which WETH/USDC fee tier they bind. Values mirror
 * `src/registry/compare-pools.json` and `records.json`. The Nuthatch source ID
 * resolves the active registry-pinned freshness view.
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
      source_id: "messari-uniswap-v3-base-fee030",
      protocol: "uniswap-v3",
      pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
      query_id: "tier-a-dex-pool-metrics-v1",
      deployment_or_view_id: "QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh",
    },
    {
      source_id: "messari-uniswap-v3-base-fee005",
      protocol: "uniswap-v3",
      pool_address: "0xd0b53d9277642d899df5c87a3966a349a798f224",
      query_id: "tier-a-dex-pool-metrics-v1",
      deployment_or_view_id: "QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh",
    },
  ],
  /** Active registry-pinned source for the Nuthatch freshness fact. */
  nuthatchSourceId: "nuthatch-pool-swaps",
} as const;

export type M0ComparePoolsScope = typeof M0_COMPARE_POOLS_SCOPE;
