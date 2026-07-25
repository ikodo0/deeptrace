import { getActiveComparePoolGraphSources } from "../registry/index.js";
import type { PoolSourceResult } from "../schemas/source-adapter.js";
import { fetchComparePoolGraphSource } from "../sources/graph/index.js";

import type { ComparePoolsSourceGateway } from "./compare-pools-sources.js";

export interface LiveComparePoolsSourcesOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Live Graph gateway for the locked compare_pools allowlist.
 * Nuthatch remains null until a verified live freshness fact exists.
 */
export function createLiveComparePoolsSources(
  options: LiveComparePoolsSourcesOptions = {},
): ComparePoolsSourceGateway {
  return {
    fetchGraphResults(): Promise<readonly PoolSourceResult[]> {
      const bindings = getActiveComparePoolGraphSources();
      return Promise.all(
        bindings.map((binding) =>
          fetchComparePoolGraphSource(binding, {
            ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          }),
        ),
      );
    },
    fetchNuthatchResult() {
      return Promise.resolve(null);
    },
  };
}
