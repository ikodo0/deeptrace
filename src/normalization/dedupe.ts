import { normalizeAddress } from "./address.js";
import { pairIdentity, poolIdentity } from "./identities.js";
import { NormalizationError } from "./error.js";
import { normalizeCanonicalPair } from "./pair.js";
import type { CanonicalPoolCandidate } from "./types.js";

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function leastSourceId(candidate: CanonicalPoolCandidate): string {
  const sorted = [...candidate.source_ids].sort(compareStrings);
  const least = sorted[0];
  if (least === undefined) {
    throw new NormalizationError("Canonical pool candidate requires at least one source_id");
  }
  return least;
}

function candidateTieBreaker(candidate: CanonicalPoolCandidate): string {
  return JSON.stringify([
    candidate.protocol,
    candidate.pair,
    candidate.window,
    candidate.tvl_usd,
    candidate.volume_usd,
    candidate.fees_usd,
    [...candidate.source_ids].sort(compareStrings),
  ]);
}

function compareCandidates(left: CanonicalPoolCandidate, right: CanonicalPoolCandidate): number {
  const bySource = compareStrings(leastSourceId(left), leastSourceId(right));
  if (bySource !== 0) {
    return bySource;
  }

  return compareStrings(candidateTieBreaker(left), candidateTieBreaker(right));
}

function uniqueSortedSourceIds(candidates: readonly CanonicalPoolCandidate[]): string[] {
  return [...new Set(candidates.flatMap((candidate) => candidate.source_ids))].sort(compareStrings);
}

function assertCompatibleGroup(group: readonly CanonicalPoolCandidate[]): void {
  const first = group[0];
  if (first === undefined) {
    throw new NormalizationError("Cannot merge an empty pool group");
  }

  const expectedPair = pairIdentity(first.chain_id, first.pair[0].address, first.pair[1].address);

  for (const candidate of group.slice(1)) {
    const candidatePair = pairIdentity(
      candidate.chain_id,
      candidate.pair[0].address,
      candidate.pair[1].address,
    );
    if (candidatePair !== expectedPair || candidate.window !== first.window) {
      throw new NormalizationError(
        `Duplicate pool candidates disagree on pair identity or window: ${poolIdentity(
          first.chain_id,
          first.pool_address,
        )}`,
      );
    }
  }
}

function mergePoolGroup(group: readonly CanonicalPoolCandidate[]): CanonicalPoolCandidate {
  assertCompatibleGroup(group);
  const ordered = [...group].sort(compareCandidates);
  const primary = ordered[0];
  if (primary === undefined) {
    throw new NormalizationError("Cannot merge an empty pool group");
  }

  return {
    ...primary,
    pool_address: normalizeAddress(primary.pool_address),
    pair: normalizeCanonicalPair(primary.chain_id, primary.pair[0], primary.pair[1]),
    source_ids: uniqueSortedSourceIds(group),
  };
}

/**
 * Collapses candidates that share the same chain + pool address.
 *
 * Collapse is independent of input order. Conflicting non-identity fields keep
 * the primary record's values; financial fields are never synthesized across
 * sources. Differing chain/pool identities remain separate.
 */
export function deduplicateCanonicalPools(
  candidates: readonly CanonicalPoolCandidate[],
): CanonicalPoolCandidate[] {
  const groups = new Map<string, CanonicalPoolCandidate[]>();

  for (const candidate of candidates) {
    const key = poolIdentity(candidate.chain_id, candidate.pool_address);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [candidate]);
    } else {
      group.push(candidate);
    }
  }

  return [...groups.values()]
    .map((group) => mergePoolGroup(group))
    .sort((left, right) => {
      if (left.chain_id !== right.chain_id) {
        return left.chain_id - right.chain_id;
      }

      return compareStrings(left.pool_address, right.pool_address);
    });
}
