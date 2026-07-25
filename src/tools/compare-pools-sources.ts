import type { ComparePoolsRequest } from "../schemas/compare-pools-request.js";
import type { NuthatchSourceResult, PoolSourceResult } from "../schemas/source-adapter.js";

/**
 * Injected source boundary for `compare_pools`.
 * Live adapters and fixtures implement the same interface.
 */
export interface ComparePoolsSourceGateway {
  fetchGraphResults(request: ComparePoolsRequest): Promise<readonly PoolSourceResult[]>;
  /**
   * Return `null` when Nuthatch is unverified or not queried.
   * Do not invent a live freshness fact.
   */
  fetchNuthatchResult(request: ComparePoolsRequest): Promise<NuthatchSourceResult | null>;
}
