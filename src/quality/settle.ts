import type { M0RankingMetric, M0TimeWindow } from "../policy/index.js";
import { M0_CORE_POLICY, M0_WARNING_ORDER } from "../policy/index.js";
import type {
  CanonicalPair,
  ComparePoolsResponse,
  Coverage,
  NuthatchFreshnessFact,
  PoolComparisonRecord,
  ResultFreshness,
  ResultProvenance,
} from "../schemas/compare-pools.js";
import type {
  NuthatchSourceResult,
  PoolSourceResult,
  SourceFreshness,
} from "../schemas/source-adapter.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";

import { QualityError } from "./error.js";

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function sourceOrderIndex(sourceId: string): number {
  const graphIndex = M0_COMPARE_POOLS_SCOPE.graphSources.findIndex(
    (source) => source.source_id === sourceId,
  );
  if (graphIndex >= 0) {
    return graphIndex;
  }
  if (sourceId === M0_COMPARE_POOLS_SCOPE.nuthatchSourceId) {
    return M0_COMPARE_POOLS_SCOPE.graphSources.length;
  }
  return Number.MAX_SAFE_INTEGER;
}

function warningSourceId(warning: string): string {
  for (const source of M0_COMPARE_POOLS_SCOPE.graphSources) {
    if (warning.includes(source.source_id)) {
      return source.source_id;
    }
  }
  if (warning.includes(M0_COMPARE_POOLS_SCOPE.nuthatchSourceId)) {
    return M0_COMPARE_POOLS_SCOPE.nuthatchSourceId;
  }
  return "";
}

function sortWarnings(warnings: readonly string[]): string[] {
  const unique = [...new Set(warnings)];
  return unique.sort((left, right) => {
    if (M0_WARNING_ORDER[0] === "source_order") {
      const bySource =
        sourceOrderIndex(warningSourceId(left)) - sourceOrderIndex(warningSourceId(right));
      if (bySource !== 0) {
        return bySource;
      }
    }
    return compareStrings(left, right);
  });
}

function toObservedFreshness(sourceId: string, freshness: SourceFreshness): ResultFreshness {
  const lagSeconds = freshness.queried_at - freshness.indexed_block_timestamp;
  if (lagSeconds < 0) {
    throw new QualityError(
      `Source "${sourceId}" queried_at is earlier than indexed_block_timestamp.`,
    );
  }
  const status = lagSeconds > M0_CORE_POLICY.freshness.qualityStaleAfterSeconds ? "stale" : "fresh";
  return {
    source_id: sourceId,
    status,
    indexed_block: freshness.indexed_block,
    indexed_block_timestamp: freshness.indexed_block_timestamp,
    indexed_block_hash: freshness.indexed_block_hash ?? null,
    queried_at: freshness.queried_at,
    lag_seconds: lagSeconds,
  };
}

function graphResultFreshness(result: PoolSourceResult): ResultFreshness {
  if (result.freshness === null) {
    return { source_id: result.source_id, status: "unavailable" };
  }
  return toObservedFreshness(result.source_id, result.freshness);
}

function graphResultProvenance(result: PoolSourceResult): ResultProvenance {
  return {
    source_id: result.source_id,
    source_type: result.source_type,
    protocol: result.protocol,
    chain_id: result.chain_id,
    deployment_or_view_id: result.provenance.deployment_or_view_id,
    schema_version: result.provenance.schema_version,
    methodology_version: result.provenance.methodology_version,
    query_id: result.provenance.query_id,
  };
}

function nuthatchUnavailableProvenance(): ResultProvenance {
  const protocol = M0_COMPARE_POOLS_SCOPE.graphSources[0]?.protocol;
  if (protocol === undefined) {
    throw new QualityError("Locked Graph scope is missing a protocol for Nuthatch provenance.");
  }
  return {
    source_id: M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
    source_type: "nuthatch_view",
    protocol,
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    deployment_or_view_id: "unverified-nuthatch-view",
    schema_version: null,
    methodology_version: null,
    query_id: "nuthatch-pool-swap-freshness-v1",
  };
}

function nuthatchResultProvenance(result: NuthatchSourceResult): ResultProvenance {
  return {
    source_id: result.source_id,
    source_type: result.source_type,
    protocol: result.protocol,
    chain_id: result.chain_id,
    deployment_or_view_id: result.provenance.deployment_or_view_id,
    schema_version: result.provenance.schema_version,
    methodology_version: result.provenance.methodology_version,
    query_id: result.provenance.query_id,
  };
}

function nuthatchFreshnessEntry(result: NuthatchSourceResult | null): ResultFreshness {
  // Public quality freshness for Nuthatch is only observed when the adapter
  // returned ok data. Non-ok results with retained freshness stay unavailable
  // so fact/coverage/freshness stay schema-aligned.
  if (result === null || result.status !== "ok" || result.freshness === null) {
    return {
      source_id: result?.source_id ?? M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
      status: "unavailable",
    };
  }
  return toObservedFreshness(result.source_id, result.freshness);
}

function nuthatchFact(result: NuthatchSourceResult | null): NuthatchFreshnessFact | null {
  if (result === null || result.status !== "ok") {
    return null;
  }
  return {
    pool_address: result.data.pool_address,
    recent_swap_count_24h: result.data.recent_swap_count_24h,
    last_swap_block: result.data.last_swap_block,
    last_swap_block_timestamp: result.data.last_swap_block_timestamp,
    source_id: result.source_id,
  };
}

function settlementWarnings(
  graphResults: readonly PoolSourceResult[],
  nuthatchResult: NuthatchSourceResult | null,
  freshness: readonly ResultFreshness[],
): string[] {
  const warnings: string[] = [];

  for (const result of graphResults) {
    warnings.push(...result.warnings);
    if (result.status === "timeout") {
      warnings.push(`${result.source_id} timed out`);
    } else if (result.status === "error") {
      warnings.push(`${result.source_id} returned an error`);
    } else if (result.status === "unsupported") {
      warnings.push(`${result.source_id} is unsupported for this request`);
    } else if (result.status === "stale") {
      warnings.push(`${result.source_id} reported adapter-stale status`);
    }
  }

  for (const entry of freshness) {
    if (entry.status === "stale") {
      warnings.push(`${entry.source_id} exceeded the freshness threshold`);
    }
  }

  if (nuthatchResult === null) {
    warnings.push(
      `${M0_COMPARE_POOLS_SCOPE.nuthatchSourceId} live freshness fact is not yet verified`,
    );
  } else {
    warnings.push(...nuthatchResult.warnings);
    if (nuthatchResult.status !== "ok") {
      warnings.push(`${nuthatchResult.source_id} was unavailable`);
    }
  }

  return sortWarnings(warnings);
}

function determineStatus(input: {
  readonly successfulDeployments: number;
  readonly nuthatchAvailable: boolean;
  readonly freshness: readonly ResultFreshness[];
  readonly poolCount: number;
}): "complete" | "partial" | "failed" {
  if (input.poolCount === 0 || input.successfulDeployments === 0) {
    return "failed";
  }

  const hasDegradedCoverage =
    input.successfulDeployments < M0_CORE_POLICY.coverage.expectedGraphResults ||
    (M0_CORE_POLICY.coverage.requiresNuthatchForComplete && !input.nuthatchAvailable) ||
    input.freshness.some((entry) => entry.status !== "fresh");

  return hasDegradedCoverage ? "partial" : "complete";
}

export interface SettleComparePoolsInput {
  readonly pair: CanonicalPair;
  readonly window: M0TimeWindow;
  readonly rankedBy: M0RankingMetric;
  readonly pools: readonly PoolComparisonRecord[];
  readonly graphResults: readonly PoolSourceResult[];
  /** Pass `null` when Nuthatch is unverified or not queried. Do not invent a fact. */
  readonly nuthatchResult: NuthatchSourceResult | null;
}

/**
 * Settles independent Graph (+ optional Nuthatch) source results into the public
 * compare_pools quality envelope.
 *
 * Does not re-rank pools. Quality freshness uses the core lag threshold without
 * rewriting adapter-owned source status.
 */
export function settleComparePoolsResult(input: SettleComparePoolsInput): ComparePoolsResponse {
  if (input.graphResults.length !== M0_CORE_POLICY.coverage.expectedGraphResults) {
    throw new QualityError(
      `Expected ${String(M0_CORE_POLICY.coverage.expectedGraphResults)} Graph source results.`,
    );
  }

  const expectedIds = M0_COMPARE_POOLS_SCOPE.graphSources.map((source) => source.source_id);
  const observedIds = input.graphResults.map((result) => result.source_id);
  if (
    observedIds.length !== new Set(observedIds).size ||
    expectedIds.some((sourceId) => !observedIds.includes(sourceId))
  ) {
    throw new QualityError("Graph results must cover the locked compare_pools source allowlist.");
  }

  const orderedGraph = expectedIds.map((sourceId) =>
    input.graphResults.find((result) => result.source_id === sourceId)!,
  );

  const okGraphCount = orderedGraph.filter((result) => result.status === "ok").length;
  if (okGraphCount > 0 && input.pools.length === 0) {
    throw new QualityError(
      "Successful Graph source results require ranked pool records before settlement.",
    );
  }
  if (input.pools.length > okGraphCount) {
    throw new QualityError(
      "Ranked pool count cannot exceed the number of successful Graph source results.",
    );
  }

  const nuthatchAvailable = input.nuthatchResult !== null && input.nuthatchResult.status === "ok";
  const fact = nuthatchFact(input.nuthatchResult);

  if (nuthatchAvailable !== (fact !== null)) {
    throw new QualityError("Nuthatch availability must match freshness-fact presence.");
  }

  const freshness: ResultFreshness[] = [
    ...orderedGraph.map(graphResultFreshness),
    nuthatchFreshnessEntry(input.nuthatchResult),
  ];
  const provenance: ResultProvenance[] = [
    ...orderedGraph.map(graphResultProvenance),
    input.nuthatchResult === null
      ? nuthatchUnavailableProvenance()
      : nuthatchResultProvenance(input.nuthatchResult),
  ];

  const coverage: Coverage = {
    requested_deployments: M0_CORE_POLICY.coverage.expectedGraphResults,
    successful_deployments: input.pools.length,
    nuthatch_available: nuthatchAvailable,
  };

  const status = determineStatus({
    successfulDeployments: coverage.successful_deployments,
    nuthatchAvailable,
    freshness,
    poolCount: input.pools.length,
  });

  const warnings = settlementWarnings(orderedGraph, input.nuthatchResult, freshness);
  if (input.pools.length < okGraphCount) {
    warnings.push(
      `Top-N truncated ranked pools from ${String(okGraphCount)} to ${String(input.pools.length)}.`,
    );
  }
  const orderedWarnings = sortWarnings(warnings);
  if (status === "partial" && orderedWarnings.length === 0) {
    throw new QualityError("Partial responses require at least one warning.");
  }

  if (status === "failed") {
    return {
      status,
      data: null,
      coverage: {
        requested_deployments: M0_CORE_POLICY.coverage.expectedGraphResults,
        successful_deployments: 0,
        nuthatch_available: nuthatchAvailable,
      },
      freshness,
      provenance,
      warnings:
        orderedWarnings.length > 0
          ? orderedWarnings
          : sortWarnings(["No valid Graph pool record was available"]),
      pagination: null,
    };
  }

  return {
    status,
    data: {
      chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
      pair: input.pair,
      window: input.window,
      ranked_by: input.rankedBy,
      pools: [...input.pools],
      nuthatch_freshness_fact: fact,
    },
    coverage,
    freshness,
    provenance,
    warnings: orderedWarnings,
    pagination: null,
  };
}
