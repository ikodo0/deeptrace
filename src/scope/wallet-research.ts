import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import { LSS_SCOPE } from "./large-swaps.js";

export const WALLET_RESEARCH_SECTIONS = [
  "activity",
  "counterparties",
  "protocol_usage",
  "observable_flows",
  "observed_assets",
  "positions",
] as const;

export type WalletResearchSection = (typeof WALLET_RESEARCH_SECTIONS)[number];

export const WALLET_RESEARCH_WINDOWS = ["24h", "7d"] as const;

export const WALLET_RESEARCH_SCOPE = {
  chainId: BASE_CHAIN_ID,
  sections: WALLET_RESEARCH_SECTIONS,
  windows: WALLET_RESEARCH_WINDOWS,
  limit: {
    default: 25,
    maximum: 50,
  },
  cursor: {
    version: 1,
    maximumLength: 2_048,
  },
  scan: {
    maximumRows: 5_000,
  },
  graph: {
    sourceId: "messari-aave-v3-base-wallet",
    protocol: "aave-v3",
    subgraphId: "D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9",
    deploymentId: "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
    queryId: "messari-lending-wallet-positions-v1",
  },
  nuthatch: {
    sourceId: "nuthatch-wallet-activity",
    protocol: LSS_SCOPE.protocol,
    viewId: "wallet_swap_activity",
    queryId: "nuthatch-wallet-swap-activity-v1",
    methodologyVersion: "bounded-wallet-swap-keyset-v1",
  },
  poolAddress: LSS_SCOPE.poolAddress,
  tokens: LSS_SCOPE.tokens,
} as const;
