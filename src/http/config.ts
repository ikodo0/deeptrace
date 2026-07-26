import { parseBoundedPositiveInteger } from "../config/positive-integer.js";
import { ConfigurationError } from "../errors/application-error.js";

/** Overrideable HTTP transport defaults. */
export const HTTP_DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  sessionIdleTimeoutMs: 1_800_000,
  sessionSweepIntervalMs: 60_000,
} as const;

/** Highest accepted values for HTTP transport settings. */
export const HTTP_MAXIMUMS = {
  port: 65_535,
  // Node timers clamp larger delays to 1 ms, so never accept them.
  sessionIdleTimeoutMs: 2_147_483_647,
  sessionSweepIntervalMs: 2_147_483_647,
} as const;

export const HTTP_ENV_VARS = {
  host: "DEEPTRACE_HTTP_HOST",
  port: "DEEPTRACE_HTTP_PORT",
  sessionIdleTimeoutMs: "DEEPTRACE_HTTP_SESSION_IDLE_TIMEOUT_MS",
  sessionSweepIntervalMs: "DEEPTRACE_HTTP_SESSION_SWEEP_INTERVAL_MS",
  sharedToken: "DEEPTRACE_HTTP_TOKEN",
} as const;

/** Shortest bearer token accepted, so a stray value cannot be brute forced. */
export const MIN_TOKEN_LENGTH = 32;

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly sessionIdleTimeoutMs: number;
  readonly sessionSweepIntervalMs: number;
  /**
   * The single credential every client shared before per-client tokens
   * existed. Undefined once it is retired, which leaves issued tokens as the
   * only way in. One leak of this value compromises every client at once and
   * cannot be revoked selectively, so it is kept only for migration.
   */
  readonly sharedToken: string | undefined;
}

type EnvSource = Record<string, string | undefined>;

function readOptionalBoundedPositiveInteger(
  env: EnvSource,
  variableName: string,
  fallback: number,
  maximum: number,
  invalidNames: string[],
): number {
  const raw = env[variableName];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  try {
    return parseBoundedPositiveInteger(raw, variableName, maximum);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      invalidNames.push(variableName);
      return fallback;
    }
    throw error;
  }
}

/**
 * Loads HTTP transport settings from the environment.
 *
 * Omitting the shared token retires it rather than failing: clients hold their
 * own issued tokens, so the listener stays authenticated without it. Retiring
 * it is therefore an operational step — remove the variable — and needs no
 * code change. A value that is present but too short is still a
 * misconfiguration, since a weak shared secret is worse than none.
 * Invalid overrides throw ConfigurationError naming the variables only.
 */
export function loadHttpConfig(env: EnvSource = process.env): HttpConfig {
  const invalidNames: string[] = [];

  const rawHost = env[HTTP_ENV_VARS.host]?.trim();
  const host = rawHost === undefined || rawHost === "" ? HTTP_DEFAULTS.host : rawHost;

  const port = readOptionalBoundedPositiveInteger(
    env,
    HTTP_ENV_VARS.port,
    HTTP_DEFAULTS.port,
    HTTP_MAXIMUMS.port,
    invalidNames,
  );
  const sessionIdleTimeoutMs = readOptionalBoundedPositiveInteger(
    env,
    HTTP_ENV_VARS.sessionIdleTimeoutMs,
    HTTP_DEFAULTS.sessionIdleTimeoutMs,
    HTTP_MAXIMUMS.sessionIdleTimeoutMs,
    invalidNames,
  );
  const sessionSweepIntervalMs = readOptionalBoundedPositiveInteger(
    env,
    HTTP_ENV_VARS.sessionSweepIntervalMs,
    HTTP_DEFAULTS.sessionSweepIntervalMs,
    HTTP_MAXIMUMS.sessionSweepIntervalMs,
    invalidNames,
  );

  const rawSharedToken = env[HTTP_ENV_VARS.sharedToken]?.trim() ?? "";
  const sharedToken = rawSharedToken === "" ? undefined : rawSharedToken;
  if (sharedToken !== undefined && sharedToken.length < MIN_TOKEN_LENGTH) {
    invalidNames.push(HTTP_ENV_VARS.sharedToken);
  }

  if (invalidNames.length > 0) {
    throw new ConfigurationError(invalidNames);
  }

  return { host, port, sessionIdleTimeoutMs, sessionSweepIntervalMs, sharedToken };
}
