import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Locked Large Swap Search v1 allowlist.
 *
 * Live Nuthatch bindings resolve through the registry record named below.
 */
export const LSS_SCOPE = {
  chainId: BASE_CHAIN_ID,
  protocol: "uniswap-v3",
  poolAddress: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
  source: {
    sourceId: "nuthatch-large-swaps",
    viewId: "pool_swap_search",
    queryId: "nuthatch-pool-swap-search-v1",
    methodologyVersion: "exact-pool-delta-keyset-v1",
  },
  tokens: {
    weth: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
    },
    usdc: {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      decimals: 6,
    },
  },
  limit: {
    default: 25,
    maximum: 100,
  },
  cursor: {
    version: 1,
    maximumLength: 2_048,
  },
  scan: {
    batchSize: 256,
    maximumRows: 50_000,
  },
} as const;

export type LssScope = typeof LSS_SCOPE;
