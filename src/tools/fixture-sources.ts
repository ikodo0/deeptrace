import type { PoolSourceResult } from "../schemas/source-adapter.js";

import type { ComparePoolsSourceGateway } from "./compare-pools-sources.js";

/**
 * Deterministic fixture gateway for tests and offline MCP demos.
 * Callers supply the two locked Graph results; Nuthatch stays null by default.
 */
export function createFixtureComparePoolsSources(options: {
  readonly graphResults: readonly PoolSourceResult[];
  readonly onGraphFetch?: () => void;
  readonly onNuthatchFetch?: () => void;
}): ComparePoolsSourceGateway {
  return {
    fetchGraphResults() {
      options.onGraphFetch?.();
      return Promise.resolve(options.graphResults);
    },
    fetchNuthatchResult() {
      options.onNuthatchFetch?.();
      return Promise.resolve(null);
    },
  };
}
