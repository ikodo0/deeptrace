import { getSourceById, RegistryConfigurationError } from "../registry/index.js";
import type { GraphSourceRegistryRecord, NuthatchSourceRegistryRecord } from "../registry/types.js";
import { WALLET_RESEARCH_SCOPE } from "../scope/wallet-research.js";
import {
  fetchWalletGraphPositions,
  walletGraphProvenance,
} from "../sources/graph/wallet-adapter.js";
import { createNuthatchClient, type NuthatchClient } from "../sources/nuthatch/client.js";
import {
  createWalletActivityFailure,
  fetchNuthatchWalletActivity,
  walletActivityProvenance,
} from "../sources/nuthatch/wallet-activity-adapter.js";

import type { WalletResearchSourceGateway } from "./wallet-sources.js";

type Environment = Readonly<Record<string, string | undefined>>;

function graphRecord(): GraphSourceRegistryRecord {
  const record = getSourceById(WALLET_RESEARCH_SCOPE.graph.sourceId);
  if (record === undefined || record.source_type === "nuthatch_view") {
    throw new RegistryConfigurationError([
      `records.json: required wallet Graph source "${WALLET_RESEARCH_SCOPE.graph.sourceId}" is missing or invalid`,
    ]);
  }
  return record;
}

function nuthatchRecord(): NuthatchSourceRegistryRecord {
  const record = getSourceById(WALLET_RESEARCH_SCOPE.nuthatch.sourceId);
  if (record === undefined || record.source_type !== "nuthatch_view") {
    throw new RegistryConfigurationError([
      `records.json: required wallet Nuthatch source "${WALLET_RESEARCH_SCOPE.nuthatch.sourceId}" is missing or invalid`,
    ]);
  }
  return record;
}

export interface LiveWalletSourcesOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly environment?: Environment;
  readonly graphApiKey?: string;
  readonly nuthatchBaseUrl?: string;
  readonly clock?: () => number;
}

export function createLiveWalletSources(
  options: LiveWalletSourcesOptions = {},
): WalletResearchSourceGateway {
  const graph = graphRecord();
  const nuthatch = nuthatchRecord();
  const environment = options.environment ?? process.env;
  const baseUrl = options.nuthatchBaseUrl ?? environment[nuthatch.locator.base_url_env];
  let client: NuthatchClient | null = null;
  if (baseUrl !== undefined && baseUrl.trim() !== "") {
    try {
      client = createNuthatchClient({
        baseUrl,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch {
      client = null;
    }
  }
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1_000));

  return {
    graphProvenance: walletGraphProvenance(graph),
    nuthatchProvenance: walletActivityProvenance(nuthatch),
    fetchPositions(request) {
      const apiKey = options.graphApiKey ?? environment.GRAPH_API_KEY;
      return fetchWalletGraphPositions(graph, request, {
        apiKey: apiKey ?? "",
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        nowSeconds: clock(),
      });
    },
    fetchActivity(context) {
      if (client === null) {
        return Promise.resolve(
          createWalletActivityFailure(
            nuthatch,
            "error",
            `Wallet activity source is unavailable because ${nuthatch.locator.base_url_env} is not configured.`,
          ),
        );
      }
      return fetchNuthatchWalletActivity({ client, clock, record: nuthatch }, context);
    },
  };
}
