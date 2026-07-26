import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Locked MVP-0 compare_lending_markets allowlist.
 *
 * Values mirror `src/registry/compare-lending.json` and `records.json`.
 * Source order is the profile priority order and is what settlement uses to
 * order freshness, provenance, and warnings deterministically.
 */
export const M0_COMPARE_LENDING_SCOPE = {
  chainId: BASE_CHAIN_ID,
  marketToken: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
  },
  sources: [
    {
      source_id: "messari-aave-v3-base",
      protocol: "aave-v3",
      deployment_or_view_id: "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
      query_id: "tier-a-lending-market-metrics-v1",
    },
    {
      source_id: "messari-seamless-base",
      protocol: "seamless-protocol",
      deployment_or_view_id: "QmPSmTkJPSKLFn46YdgwMKV5K2c9a3pkWnzDCC4ccCLAXE",
      query_id: "tier-a-lending-market-metrics-v1",
    },
    {
      source_id: "messari-moonwell-base",
      protocol: "moonwell",
      deployment_or_view_id: "QmeE6TgfRmK2iLAgCLBeXuxJQ2VXLFAeHVMTvmnECiFw7y",
      query_id: "tier-a-lending-market-metrics-v1",
    },
  ],
} as const;

export type M0CompareLendingScope = typeof M0_COMPARE_LENDING_SCOPE;
