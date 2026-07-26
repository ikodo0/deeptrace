import type { LendingMarketSourceResult } from "../schemas/source-adapter.js";

import type { CompareLendingSourceGateway } from "./compare-lending-sources.js";

/**
 * Deterministic fixture gateway for tests and offline MCP demos.
 * Callers supply the three locked lending source results.
 */
export function createFixtureCompareLendingSources(options: {
  readonly lendingResults: readonly LendingMarketSourceResult[];
  readonly onLendingFetch?: () => void;
}): CompareLendingSourceGateway {
  return {
    fetchLendingResults() {
      options.onLendingFetch?.();
      return Promise.resolve(options.lendingResults);
    },
  };
}
