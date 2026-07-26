import type { M0TimeWindow } from "../policy/index.js";
import type { PoolComparisonRecord } from "../schemas/compare-pools.js";
import { BASE_CHAIN_ID, type PoolSourceResult } from "../schemas/source-adapter.js";

import { normalizeAddress } from "./address.js";
import { NormalizationError } from "./error.js";
import { normalizeCanonicalPair } from "./pair.js";
import type { CanonicalPoolCandidate } from "./types.js";

function selectWindowMetrics(
  data: Extract<PoolSourceResult, { status: "ok" }>["data"],
  window: M0TimeWindow,
): { volume_usd: string | null; fees_usd: string | null } {
  switch (window) {
    case "24h":
      return {
        volume_usd: data.volume_usd_24h,
        fees_usd: data.fees_usd_24h,
      };
    case "7d":
      return {
        volume_usd: data.volume_usd_7d,
        fees_usd: data.fees_usd_7d,
      };
    default:
      throw new NormalizationError(`Unsupported normalization window: ${String(window)}`);
  }
}

/**
 * Converts a successful pool source result into a rank-free canonical candidate.
 * Failed source results return null and are never partially converted.
 *
 * USD decimal strings and null are passed through byte-for-byte with no
 * Number/parseFloat/arithmetic/repricing.
 */
export function convertPoolSourceResult(
  result: PoolSourceResult,
  window: M0TimeWindow,
): CanonicalPoolCandidate | null {
  if (result.status !== "ok") {
    return null;
  }

  if (result.chain_id !== BASE_CHAIN_ID) {
    throw new NormalizationError(
      `Unsupported chain_id for pool conversion: ${String(result.chain_id)}`,
    );
  }

  const { data } = result;
  const metrics = selectWindowMetrics(data, window);

  return {
    chain_id: BASE_CHAIN_ID,
    protocol: result.protocol,
    pool_address: normalizeAddress(data.pool_address),
    pair: normalizeCanonicalPair(result.chain_id, data.token0, data.token1),
    tvl_usd: data.tvl_usd,
    volume_usd: metrics.volume_usd,
    fees_usd: metrics.fees_usd,
    window,
    source_ids: [result.source_id],
  };
}

/**
 * Attaches an explicit caller-supplied rank. Ranking logic is out of scope for
 * M0-03A and must not be inferred here.
 */
export function toPoolComparisonRecord(
  candidate: CanonicalPoolCandidate,
  rank: number,
): PoolComparisonRecord {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new NormalizationError(`Rank must be a positive integer, received: ${String(rank)}`);
  }

  return {
    ...candidate,
    rank,
  };
}
