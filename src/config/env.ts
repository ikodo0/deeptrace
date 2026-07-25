import { ConfigurationError } from "../errors/application-error.js";
import { GATEWAY_DEFAULTS, GATEWAY_ENV_VARS } from "./defaults.js";
import { parseBoundedPositiveInteger } from "./positive-integer.js";

export interface GatewayConfig {
  readonly rateLimitMaxRequests: number;
  readonly rateLimitWindowMs: number;
  readonly sourceTimeoutMs: number;
}

type EnvSource = Record<string, string | undefined>;

function readOptionalBoundedPositiveInteger(
  env: EnvSource,
  variableName: string,
  fallback: number,
  invalidNames: string[],
): number {
  const raw = env[variableName];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  try {
    return parseBoundedPositiveInteger(raw, variableName);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      invalidNames.push(variableName);
      return fallback;
    }
    throw error;
  }
}

/**
 * Loads gateway settings from the environment.
 * Missing or blank overrides keep documented defaults.
 * Invalid overrides throw ConfigurationError naming the variables only.
 */
export function loadGatewayConfig(env: EnvSource = process.env): GatewayConfig {
  const invalidNames: string[] = [];

  const rateLimitMaxRequests = readOptionalBoundedPositiveInteger(
    env,
    GATEWAY_ENV_VARS.rateLimitMaxRequests,
    GATEWAY_DEFAULTS.rateLimitMaxRequests,
    invalidNames,
  );
  const rateLimitWindowMs = readOptionalBoundedPositiveInteger(
    env,
    GATEWAY_ENV_VARS.rateLimitWindowMs,
    GATEWAY_DEFAULTS.rateLimitWindowMs,
    invalidNames,
  );
  const sourceTimeoutMs = readOptionalBoundedPositiveInteger(
    env,
    GATEWAY_ENV_VARS.sourceTimeoutMs,
    GATEWAY_DEFAULTS.sourceTimeoutMs,
    invalidNames,
  );

  if (invalidNames.length > 0) {
    throw new ConfigurationError(invalidNames);
  }

  return {
    rateLimitMaxRequests,
    rateLimitWindowMs,
    sourceTimeoutMs,
  };
}
