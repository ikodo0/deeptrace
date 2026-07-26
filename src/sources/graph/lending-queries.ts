/**
 * Locked metrics query for compare_lending_markets Graph sources.
 *
 * Query identity must stay aligned with `src/registry/compare-lending.json`:
 * the profile names the query a binding is served with, and the adapter
 * refuses any id it does not implement.
 */

/**
 * Tier-A lending metrics over the Messari `lending-protocol` standard, which
 * every shipped `compare_lending_markets` binding uses.
 *
 * Field notes that are easy to get wrong:
 * - `lendingProtocols.network` is read back and checked against the locked
 *   scope, because a Messari deployment listed for one network can be indexed
 *   against another;
 * - `markets` is filtered by `inputToken` rather than fetched by id, because a
 *   market address differs per protocol while the compared asset does not;
 * - five markets are requested so a deployment that exposes more than one
 *   market for the same input token is visible to the adapter instead of being
 *   silently reduced to the first row;
 * - `inputToken.decimals` is an Int here, unlike the native schemas where it is
 *   a string;
 * - `rates` is a set, not a fixed triple: a protocol that offers no stable
 *   borrow rate simply omits that entry.
 */
export const TIER_A_LENDING_METRICS_QUERY_ID = "tier-a-lending-market-metrics-v1" as const;

export const TIER_A_LENDING_METRICS_QUERY = `query TierALendingMarketMetrics($token: String!) {
  _meta {
    block { number timestamp hash }
    hasIndexingErrors
    deployment
  }
  lendingProtocols(first: 1) {
    id name slug schemaVersion methodologyVersion network type lendingType
  }
  markets(first: 5, where: { inputToken: $token }) {
    id name isActive canBorrowFrom canUseAsCollateral
    totalValueLockedUSD totalDepositBalanceUSD totalBorrowBalanceUSD
    inputToken { id symbol decimals }
    rates { id side type rate }
  }
}`;
