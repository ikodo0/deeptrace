import { M0_CORE_POLICY, type M0LendingRankingMetric } from "../policy/index.js";
import { NormalizationError } from "../normalization/error.js";
import type { LendingMarketRecord } from "../schemas/compare-lending.js";
import type {
  LendingMarketSourceData,
  LendingMarketSourceResult,
} from "../schemas/source-adapter.js";

import { compareMetricDescNullsLast } from "./decimal-order.js";

type SuccessfulLendingResult = Extract<LendingMarketSourceResult, { status: "ok" }>;

function compareStringsAsc(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function metricValue(
  data: LendingMarketSourceData,
  rankedBy: M0LendingRankingMetric,
): string | null {
  switch (rankedBy) {
    case "tvl_usd":
      return data.tvl_usd;
    case "total_deposit_balance_usd":
      return data.total_deposit_balance_usd;
    case "total_borrow_balance_usd":
      return data.total_borrow_balance_usd;
    case "lender_variable_rate_percent":
      return data.lender_variable_rate_percent;
    case "borrower_variable_rate_percent":
      return data.borrower_variable_rate_percent;
    default: {
      const exhaustive: never = rankedBy;
      throw new NormalizationError(`Unsupported lending ranking metric: ${String(exhaustive)}`);
    }
  }
}

function compareForRanking(
  left: SuccessfulLendingResult,
  right: SuccessfulLendingResult,
  rankedBy: M0LendingRankingMetric,
): number {
  const byMetric = compareMetricDescNullsLast(
    metricValue(left.data, rankedBy),
    metricValue(right.data, rankedBy),
  );
  if (byMetric !== 0) {
    return byMetric;
  }

  const byProtocol = compareStringsAsc(left.protocol, right.protocol);
  if (byProtocol !== 0) {
    return byProtocol;
  }

  const byMarket = compareStringsAsc(left.data.market_id, right.data.market_id);
  if (byMarket !== 0) {
    return byMarket;
  }

  return compareStringsAsc(left.source_id, right.source_id);
}

function toLendingMarketRecord(result: SuccessfulLendingResult, rank: number): LendingMarketRecord {
  return {
    chain_id: result.chain_id,
    protocol: result.protocol,
    market_id: result.data.market_id,
    market_name: result.data.market_name,
    input_token: {
      chain_id: result.chain_id,
      address: result.data.input_token.address,
      symbol: result.data.input_token.symbol,
      decimals: result.data.input_token.decimals,
    },
    is_active: result.data.is_active,
    can_borrow_from: result.data.can_borrow_from,
    can_use_as_collateral: result.data.can_use_as_collateral,
    tvl_usd: result.data.tvl_usd,
    total_deposit_balance_usd: result.data.total_deposit_balance_usd,
    total_borrow_balance_usd: result.data.total_borrow_balance_usd,
    lender_variable_rate_percent: result.data.lender_variable_rate_percent,
    borrower_variable_rate_percent: result.data.borrower_variable_rate_percent,
    borrower_stable_rate_percent: result.data.borrower_stable_rate_percent,
    rank,
    source_ids: [result.source_id],
  };
}

export interface RankLendingMarketsOptions {
  readonly rankedBy: M0LendingRankingMetric;
  readonly topN?: number;
}

/**
 * Ranks the markets that answered by the requested metric with deterministic
 * tie-breaks and returns Top-N `LendingMarketRecord`s.
 *
 * Each protocol contributes at most one market for the locked asset, so unlike
 * `compare_pools` there is nothing to deduplicate across sources.
 */
export function rankLendingMarkets(
  results: readonly LendingMarketSourceResult[],
  options: RankLendingMarketsOptions,
): LendingMarketRecord[] {
  const topN = options.topN ?? M0_CORE_POLICY.lending.topN.default;
  if (!Number.isInteger(topN) || topN < 1 || topN > M0_CORE_POLICY.lending.topN.maximum) {
    throw new NormalizationError(
      `topN must be an integer between 1 and ${String(M0_CORE_POLICY.lending.topN.maximum)}`,
    );
  }

  const successful = results.filter(
    (result): result is SuccessfulLendingResult => result.status === "ok",
  );
  const ordered = [...successful].sort((left, right) =>
    compareForRanking(left, right, options.rankedBy),
  );

  return ordered.slice(0, topN).map((result, index) => toLendingMarketRecord(result, index + 1));
}
