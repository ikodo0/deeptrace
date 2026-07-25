import type { M0TimeWindow } from "../policy/index.js";
import type { CanonicalPair } from "../schemas/compare-pools.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";

/**
 * Rank-free canonical pool candidate produced by M0-03A normalization.
 *
 * Ranking belongs to M0-04. Callers that need `PoolComparisonRecord` must
 * supply an explicit rank via `toPoolComparisonRecord`.
 */
export interface CanonicalPoolCandidate {
  chain_id: typeof BASE_CHAIN_ID;
  protocol: string;
  pool_address: string;
  pair: CanonicalPair;
  tvl_usd: string | null;
  volume_usd: string | null;
  fees_usd: string | null;
  window: M0TimeWindow;
  source_ids: string[];
}

/**
 * Duplicate collapse policy for equal `chain_id` + `pool_address`:
 *
 * - Primary record = candidate whose least `source_id` is lexicographically first.
 * - Protocol, pair, window, and USD fields come only from the primary.
 * - `source_ids` become the sorted unique union across the group.
 * - USD values are never averaged, summed, maxed, or otherwise synthesized.
 */
export const DUPLICATE_POOL_COLLAPSE_POLICY =
  "primary_by_least_source_id_passthrough_metrics_merge_sorted_source_ids" as const;
