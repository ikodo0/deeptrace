/** Overrideable gateway defaults for FND-03. */
export const GATEWAY_DEFAULTS = {
  rateLimitMaxRequests: 30,
  rateLimitWindowMs: 60_000,
  sourceTimeoutMs: 5_000,
} as const;

/** Practical deployment ceilings for environment overrides. */
export const GATEWAY_MAXIMUMS = {
  rateLimitMaxRequests: 300,
  rateLimitWindowMs: 3_600_000,
  sourceTimeoutMs: 8_000,
} as const;

export const GATEWAY_ENV_VARS = {
  rateLimitMaxRequests: "DEEPTRACE_RATE_LIMIT_MAX_REQUESTS",
  rateLimitWindowMs: "DEEPTRACE_RATE_LIMIT_WINDOW_MS",
  sourceTimeoutMs: "DEEPTRACE_SOURCE_TIMEOUT_MS",
} as const;

/** Inclusive upper bound for gateway positive-integer settings. */
export const MAX_BOUNDED_POSITIVE_INTEGER = Number.MAX_SAFE_INTEGER;
