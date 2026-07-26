import type { M0TimeWindow } from "../policy/index.js";
import type { PoolSourceResult, TokenMetadata } from "../schemas/source-adapter.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";

import { convertPoolSourceResult } from "./convert.js";
import { NormalizationError } from "./error.js";
import type { CanonicalPoolCandidate } from "./types.js";

type ScopedGraphSource = (typeof M0_COMPARE_POOLS_SCOPE.graphSources)[number];

function findScopedGraphSource(sourceId: string): ScopedGraphSource | undefined {
  return M0_COMPARE_POOLS_SCOPE.graphSources.find((source) => source.source_id === sourceId);
}

function assertLockedTokenMetadata(token: TokenMetadata): void {
  const expected =
    token.address === M0_COMPARE_POOLS_SCOPE.token0.address
      ? M0_COMPARE_POOLS_SCOPE.token0
      : token.address === M0_COMPARE_POOLS_SCOPE.token1.address
        ? M0_COMPARE_POOLS_SCOPE.token1
        : null;

  if (
    expected === null ||
    token.symbol !== expected.symbol ||
    token.decimals !== expected.decimals
  ) {
    throw new NormalizationError(
      "Pool token metadata does not match the locked compare_pools pair.",
    );
  }
}

function assertScopedGraphResult(result: PoolSourceResult, scoped: ScopedGraphSource): void {
  if (result.chain_id !== M0_COMPARE_POOLS_SCOPE.chainId) {
    throw new NormalizationError(
      `Source "${result.source_id}" is outside the locked compare_pools chain.`,
    );
  }

  if (result.protocol !== scoped.protocol) {
    throw new NormalizationError(
      `Source "${result.source_id}" protocol does not match the locked Graph scope.`,
    );
  }

  if (result.provenance.deployment_or_view_id !== scoped.deployment_or_view_id) {
    throw new NormalizationError(
      `Source "${result.source_id}" deployment does not match the locked Graph scope.`,
    );
  }

  if (result.provenance.query_id !== scoped.query_id) {
    throw new NormalizationError(
      `Source "${result.source_id}" query_id does not match the locked Graph scope.`,
    );
  }

  if (result.status !== "ok") {
    return;
  }

  if (result.data.pool_address !== scoped.pool_address) {
    throw new NormalizationError(
      `Source "${result.source_id}" pool address does not match the locked Graph scope.`,
    );
  }

  const { token0, token1 } = result.data;
  if (
    token0.address === token1.address ||
    (token0.address !== M0_COMPARE_POOLS_SCOPE.token0.address &&
      token0.address !== M0_COMPARE_POOLS_SCOPE.token1.address) ||
    (token1.address !== M0_COMPARE_POOLS_SCOPE.token0.address &&
      token1.address !== M0_COMPARE_POOLS_SCOPE.token1.address)
  ) {
    throw new NormalizationError(
      `Source "${result.source_id}" tokens are outside the locked compare_pools pair.`,
    );
  }

  assertLockedTokenMetadata(token0);
  assertLockedTokenMetadata(token1);
}

/**
 * Binds a Graph `PoolSourceResult` to the locked compare_pools allowlist, then
 * converts successful results with the pure M0-03A normalizer.
 *
 * Out-of-scope chain, source, deployment, pool, or pair selections fail before
 * metric selection. Non-`ok` in-scope results still return `null`.
 */
export function bindComparePoolsGraphResult(
  result: PoolSourceResult,
  window: M0TimeWindow,
): CanonicalPoolCandidate | null {
  if (result.source_id === M0_COMPARE_POOLS_SCOPE.nuthatchSourceId) {
    throw new NormalizationError(
      "Nuthatch results are not Graph pool candidates for compare_pools normalization.",
    );
  }

  const scoped = findScopedGraphSource(result.source_id);
  if (scoped === undefined) {
    throw new NormalizationError(
      `Source "${result.source_id}" is not in the locked compare_pools Graph allowlist.`,
    );
  }

  assertScopedGraphResult(result, scoped);
  return convertPoolSourceResult(result, window);
}

/**
 * Binds and converts every Graph result. Failed/timeout sources contribute no
 * candidate. Out-of-scope sources throw before any candidate is returned.
 */
export function bindComparePoolsGraphResults(
  results: readonly PoolSourceResult[],
  window: M0TimeWindow,
): CanonicalPoolCandidate[] {
  const candidates: CanonicalPoolCandidate[] = [];
  for (const result of results) {
    const candidate = bindComparePoolsGraphResult(result, window);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
