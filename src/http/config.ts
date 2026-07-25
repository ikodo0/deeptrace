import { parseBoundedPositiveInteger } from "../config/positive-integer.js";
import { ConfigurationError } from "../errors/application-error.js";

/** Overrideable HTTP transport defaults. */
export const HTTP_DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
} as const;

/** Highest port number the transport will bind. */
export const HTTP_MAXIMUMS = {
  port: 65_535,
} as const;

export const HTTP_ENV_VARS = {
  host: "DEEPTRACE_HTTP_HOST",
  port: "DEEPTRACE_HTTP_PORT",
  token: "DEEPTRACE_HTTP_TOKEN",
} as const;

/** Shortest bearer token accepted, so a stray value cannot be brute forced. */
export const MIN_TOKEN_LENGTH = 32;

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

type EnvSource = Record<string, string | undefined>;

/**
 * Loads HTTP transport settings from the environment.
 * The bearer token is mandatory: this transport is reachable off-host, so an
 * unauthenticated listener is never a valid configuration.
 * Invalid overrides throw ConfigurationError naming the variables only.
 */
export function loadHttpConfig(env: EnvSource = process.env): HttpConfig {
  const invalidNames: string[] = [];

  const rawHost = env[HTTP_ENV_VARS.host]?.trim();
  const host = rawHost === undefined || rawHost === "" ? HTTP_DEFAULTS.host : rawHost;

  const rawPort = env[HTTP_ENV_VARS.port]?.trim();
  let port: number = HTTP_DEFAULTS.port;
  if (rawPort !== undefined && rawPort !== "") {
    try {
      port = parseBoundedPositiveInteger(rawPort, HTTP_ENV_VARS.port, HTTP_MAXIMUMS.port);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }
      invalidNames.push(HTTP_ENV_VARS.port);
    }
  }

  const token = env[HTTP_ENV_VARS.token]?.trim() ?? "";
  if (token.length < MIN_TOKEN_LENGTH) {
    invalidNames.push(HTTP_ENV_VARS.token);
  }

  if (invalidNames.length > 0) {
    throw new ConfigurationError(invalidNames);
  }

  return { host, port, token };
}
