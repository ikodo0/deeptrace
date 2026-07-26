import type { M0LendingRankingMetric } from "../policy/index.js";
import { M0_CORE_POLICY, M0_WARNING_ORDER } from "../policy/index.js";
import type {
  CompareLendingResponse,
  LendingCoverage,
  LendingMarketRecord,
  LendingToken,
} from "../schemas/compare-lending.js";
import type { ResultFreshness, ResultProvenance } from "../schemas/compare-pools.js";
import type { LendingMarketSourceResult, SourceFreshness } from "../schemas/source-adapter.js";
import { M0_COMPARE_LENDING_SCOPE } from "../scope/compare-lending.js";

import { QualityError } from "./error.js";

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function sourceOrderIndex(sourceId: string): number {
  const index = M0_COMPARE_LENDING_SCOPE.sources.findIndex(
    (source) => source.source_id === sourceId,
  );
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function warningSourceId(warning: string): string {
  for (const source of M0_COMPARE_LENDING_SCOPE.sources) {
    if (warning.includes(source.source_id)) {
      return source.source_id;
    }
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

function resultFreshness(result: LendingMarketSourceResult): ResultFreshness {
  if (result.status !== "ok" || result.freshness === null) {
    return { source_id: result.source_id, status: "unavailable" };
  }
  return toObservedFreshness(result.source_id, result.freshness);
}

function resultProvenance(result: LendingMarketSourceResult): ResultProvenance {
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

function settlementWarnings(
  results: readonly LendingMarketSourceResult[],
  freshness: readonly ResultFreshness[],
): string[] {
  const warnings: string[] = [];

  for (const result of results) {
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

  return sortWarnings(warnings);
}

function determineStatus(input: {
  readonly successfulSources: number;
  readonly freshness: readonly ResultFreshness[];
  readonly marketCount: number;
}): "complete" | "partial" | "failed" {
  if (input.marketCount === 0 || input.successfulSources === 0) {
    return "failed";
  }

  const hasDegradedCoverage =
    input.successfulSources < M0_CORE_POLICY.lending.coverage.expectedSources ||
    input.freshness.some((entry) => entry.status !== "fresh");

  return hasDegradedCoverage ? "partial" : "complete";
}

export interface SettleCompareLendingInput {
  readonly marketToken: LendingToken;
  readonly rankedBy: M0LendingRankingMetric;
  readonly markets: readonly LendingMarketRecord[];
  readonly sourceResults: readonly LendingMarketSourceResult[];
}

/**
 * Settles independent lending source results into the public
 * compare_lending_markets quality envelope.
 *
 * Does not re-rank markets. Quality freshness uses the core lag threshold
 * without rewriting adapter-owned source status.
 */
export function settleCompareLendingResult(
  input: SettleCompareLendingInput,
): CompareLendingResponse {
  if (input.sourceResults.length !== M0_CORE_POLICY.lending.coverage.expectedSources) {
    throw new QualityError(
      `Expected ${String(M0_CORE_POLICY.lending.coverage.expectedSources)} lending source results.`,
    );
  }

  const expectedIds = M0_COMPARE_LENDING_SCOPE.sources.map((source) => source.source_id);
  const observedIds = input.sourceResults.map((result) => result.source_id);
  if (
    observedIds.length !== new Set(observedIds).size ||
    expectedIds.some((sourceId) => !observedIds.includes(sourceId))
  ) {
    throw new QualityError(
      "Lending results must cover the locked compare_lending_markets source allowlist.",
    );
  }

  const ordered = expectedIds.map((sourceId) =>
    input.sourceResults.find((result) => result.source_id === sourceId)!,
  );

  const okCount = ordered.filter((result) => result.status === "ok").length;
  if (okCount > 0 && input.markets.length === 0) {
    throw new QualityError(
      "Successful lending source results require ranked market records before settlement.",
    );
  }
  if (input.markets.length > okCount) {
    throw new QualityError(
      "Ranked market count cannot exceed the number of successful lending source results.",
    );
  }

  const freshness: ResultFreshness[] = ordered.map(resultFreshness);
  const provenance: ResultProvenance[] = ordered.map(resultProvenance);

  const coverage: LendingCoverage = {
    requested_sources: M0_CORE_POLICY.lending.coverage.expectedSources,
    successful_sources: input.markets.length,
  };

  const status = determineStatus({
    successfulSources: coverage.successful_sources,
    freshness,
    marketCount: input.markets.length,
  });

  const warnings = settlementWarnings(ordered, freshness);
  if (input.markets.length < okCount) {
    warnings.push(
      `Top-N truncated ranked markets from ${String(okCount)} to ${String(input.markets.length)}.`,
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
        requested_sources: M0_CORE_POLICY.lending.coverage.expectedSources,
        successful_sources: 0,
      },
      freshness,
      provenance,
      warnings:
        orderedWarnings.length > 0
          ? orderedWarnings
          : sortWarnings(["No valid lending market record was available"]),
      pagination: null,
    };
  }

  return {
    status,
    data: {
      chain_id: M0_COMPARE_LENDING_SCOPE.chainId,
      market_token: input.marketToken,
      ranked_by: input.rankedBy,
      rate_basis: "percent_apy",
      markets: [...input.markets],
    },
    coverage,
    freshness,
    provenance,
    warnings: orderedWarnings,
    pagination: null,
  };
}
