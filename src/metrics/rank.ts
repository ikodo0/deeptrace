import { M0_CORE_POLICY, type M0RankingMetric } from "../policy/index.js";
import type { PoolComparisonRecord } from "../schemas/compare-pools.js";
import { deduplicateCanonicalPools } from "../normalization/dedupe.js";
import { toPoolComparisonRecord } from "../normalization/convert.js";
import { NormalizationError } from "../normalization/error.js";
import type { CanonicalPoolCandidate } from "../normalization/types.js";

import { compareMetricDescNullsLast } from "./decimal-order.js";

function compareStringsAsc(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function leastSourceId(candidate: CanonicalPoolCandidate): string {
  const sorted = [...candidate.source_ids].sort(compareStringsAsc);
  const least = sorted[0];
  if (least === undefined) {
    throw new NormalizationError("Canonical pool candidate requires at least one source_id");
  }
  return least;
}

function metricValue(candidate: CanonicalPoolCandidate, rankedBy: M0RankingMetric): string | null {
  switch (rankedBy) {
    case "tvl_usd":
      return candidate.tvl_usd;
    case "volume_usd":
      return candidate.volume_usd;
    case "fees_usd":
      return candidate.fees_usd;
    default: {
      const exhaustive: never = rankedBy;
      throw new NormalizationError(`Unsupported ranking metric: ${String(exhaustive)}`);
    }
  }
}

function compareForRanking(
  left: CanonicalPoolCandidate,
  right: CanonicalPoolCandidate,
  rankedBy: M0RankingMetric,
): number {
  const byMetric = compareMetricDescNullsLast(
    metricValue(left, rankedBy),
    metricValue(right, rankedBy),
  );
  if (byMetric !== 0) {
    return byMetric;
  }

  const byProtocol = compareStringsAsc(left.protocol, right.protocol);
  if (byProtocol !== 0) {
    return byProtocol;
  }

  const byPool = compareStringsAsc(left.pool_address, right.pool_address);
  if (byPool !== 0) {
    return byPool;
  }

  return compareStringsAsc(leastSourceId(left), leastSourceId(right));
}

export interface RankPoolsOptions {
  readonly rankedBy: M0RankingMetric;
  readonly topN?: number;
}

/**
 * Deduplicate canonical pool candidates, rank by the requested metric with
 * deterministic tie-breaks, and return Top-N `PoolComparisonRecord`s.
 */
export function rankCanonicalPools(
  candidates: readonly CanonicalPoolCandidate[],
  options: RankPoolsOptions,
): PoolComparisonRecord[] {
  const topN = options.topN ?? M0_CORE_POLICY.topN.default;
  if (!Number.isInteger(topN) || topN < 1 || topN > M0_CORE_POLICY.topN.maximum) {
    throw new NormalizationError(
      `topN must be an integer between 1 and ${String(M0_CORE_POLICY.topN.maximum)}`,
    );
  }

  if (candidates.length > 0) {
    const window = candidates[0]!.window;
    if (candidates.some((candidate) => candidate.window !== window)) {
      throw new NormalizationError("Cannot rank canonical pools across mixed windows");
    }
    const chainId = candidates[0]!.chain_id;
    if (candidates.some((candidate) => candidate.chain_id !== chainId)) {
      throw new NormalizationError("Cannot rank canonical pools across mixed chains");
    }
  }

  const deduped = deduplicateCanonicalPools(candidates);
  const ordered = [...deduped].sort((left, right) =>
    compareForRanking(left, right, options.rankedBy),
  );

  return ordered
    .slice(0, topN)
    .map((candidate, index) => toPoolComparisonRecord(candidate, index + 1));
}
