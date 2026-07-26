import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Locked Large Swap Search v1 allowlist.
 *
 * Live Nuthatch view and registry bindings are intentionally deferred to LSS-04.
 */
export const LSS_SCOPE = {
  chainId: BASE_CHAIN_ID,
  protocol: "uniswap-v3",
  poolAddress: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
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
} as const;

export type LssScope = typeof LSS_SCOPE;
