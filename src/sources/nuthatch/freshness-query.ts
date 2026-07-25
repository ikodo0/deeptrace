/**
 * Locked freshness query for the M5 Nuthatch adapter. The same string is used
 * by `/sql`, `/explain`, unit tests, CI, and the live smoke; no caller may
 * alter the SQL or interpolate a user-supplied value.
 */
export const NUTHATCH_FRESHNESS_QUERY_ID = "nuthatch-pool-swap-freshness-v1" as const;

/**
 * Deployed view name on the M4 Nuthatch nest. The adapter rejects any registry
 * record whose `locator.view_id` differs from this constant.
 */
export const NUTHATCH_FRESHNESS_VIEW = "pool_swap_freshness" as const;

/**
 * Fixed read-only SQL selecting exactly one row from the deployed freshness
 * view. The selected pool belongs to the registry/view configuration; M5 does
 * not interpolate a user-supplied address.
 */
export const NUTHATCH_FRESHNESS_QUERY = "SELECT * FROM pool_swap_freshness LIMIT 1" as const;
