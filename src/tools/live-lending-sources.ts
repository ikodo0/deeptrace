import { getActiveCompareLendingGraphSources } from "../registry/index.js";
import type { LendingMarketSourceResult } from "../schemas/source-adapter.js";
import { fetchCompareLendingGraphSource } from "../sources/graph/index.js";

import type { CompareLendingSourceGateway } from "./compare-lending-sources.js";

export interface LiveCompareLendingSourcesOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Live Graph gateway for the locked compare_lending_markets allowlist.
 */
export function createLiveCompareLendingSources(
  options: LiveCompareLendingSourcesOptions = {},
): CompareLendingSourceGateway {
  return {
    fetchLendingResults(): Promise<readonly LendingMarketSourceResult[]> {
      const bindings = getActiveCompareLendingGraphSources();
      return Promise.all(
        bindings.map((binding) =>
          fetchCompareLendingGraphSource(binding, {
            ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          }),
        ),
      );
    },
  };
}
