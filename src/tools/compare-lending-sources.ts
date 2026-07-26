import type { CompareLendingRequest } from "../schemas/compare-lending-request.js";
import type { LendingMarketSourceResult } from "../schemas/source-adapter.js";

/**
 * Injected source boundary for `compare_lending_markets`.
 * Live adapters and fixtures implement the same interface.
 */
export interface CompareLendingSourceGateway {
  fetchLendingResults(
    request: CompareLendingRequest,
  ): Promise<readonly LendingMarketSourceResult[]>;
}
