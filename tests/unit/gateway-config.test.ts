import { describe, expect, it } from "vitest";

import {
  GATEWAY_DEFAULTS,
  GATEWAY_ENV_VARS,
  GATEWAY_MAXIMUMS,
  loadGatewayConfig,
  parseBoundedPositiveInteger,
} from "../../src/config/index.js";
import { ConfigurationError } from "../../src/errors/index.js";

describe("loadGatewayConfig", () => {
  it("returns documented defaults when overrides are absent", () => {
    expect(loadGatewayConfig({})).toEqual({
      rateLimitMaxRequests: GATEWAY_DEFAULTS.rateLimitMaxRequests,
      rateLimitWindowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      sourceTimeoutMs: GATEWAY_DEFAULTS.sourceTimeoutMs,
    });
  });

  it("applies valid overrides", () => {
    expect(
      loadGatewayConfig({
        [GATEWAY_ENV_VARS.rateLimitMaxRequests]: "10",
        [GATEWAY_ENV_VARS.rateLimitWindowMs]: "120000",
        [GATEWAY_ENV_VARS.sourceTimeoutMs]: "2500",
      }),
    ).toEqual({
      rateLimitMaxRequests: 10,
      rateLimitWindowMs: 120_000,
      sourceTimeoutMs: 2_500,
    });
  });

  it("accepts each practical deployment ceiling", () => {
    expect(
      loadGatewayConfig({
        [GATEWAY_ENV_VARS.rateLimitMaxRequests]: String(GATEWAY_MAXIMUMS.rateLimitMaxRequests),
        [GATEWAY_ENV_VARS.rateLimitWindowMs]: String(GATEWAY_MAXIMUMS.rateLimitWindowMs),
        [GATEWAY_ENV_VARS.sourceTimeoutMs]: String(GATEWAY_MAXIMUMS.sourceTimeoutMs),
      }),
    ).toEqual({
      rateLimitMaxRequests: GATEWAY_MAXIMUMS.rateLimitMaxRequests,
      rateLimitWindowMs: GATEWAY_MAXIMUMS.rateLimitWindowMs,
      sourceTimeoutMs: GATEWAY_MAXIMUMS.sourceTimeoutMs,
    });
  });

  it("treats blank overrides as defaults", () => {
    expect(
      loadGatewayConfig({
        [GATEWAY_ENV_VARS.rateLimitMaxRequests]: "   ",
        [GATEWAY_ENV_VARS.rateLimitWindowMs]: "",
      }),
    ).toEqual({
      rateLimitMaxRequests: GATEWAY_DEFAULTS.rateLimitMaxRequests,
      rateLimitWindowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      sourceTimeoutMs: GATEWAY_DEFAULTS.sourceTimeoutMs,
    });
  });

  it.each([
    ["fractional", "1.5"],
    ["NaN", "NaN"],
    ["infinite", "Infinity"],
    ["negative infinite", "-Infinity"],
    ["zero", "0"],
    ["negative", "-3"],
    ["non-numeric", "abc"],
    ["scientific", "1e3"],
  ])("rejects invalid configuration for %s input", (_label, raw) => {
    expect(() =>
      loadGatewayConfig({
        [GATEWAY_ENV_VARS.sourceTimeoutMs]: raw,
      }),
    ).toThrow(ConfigurationError);
  });

  it("reports all invalid variable names without embedding raw values", () => {
    const secretMax = "leaked-secret-max-999";
    const secretWindow = "leaked-secret-window-888";

    let error: unknown;
    try {
      loadGatewayConfig({
        [GATEWAY_ENV_VARS.rateLimitMaxRequests]: secretMax,
        [GATEWAY_ENV_VARS.rateLimitWindowMs]: secretWindow,
        [GATEWAY_ENV_VARS.sourceTimeoutMs]: "5000",
        GRAPH_API_KEY: "graph-api-key-should-stay-hidden",
        NUTHATCH_ADMIN_TOKEN: "admin-token-should-stay-hidden",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    const configurationError = error as ConfigurationError;
    expect(configurationError.variableNames).toEqual([
      GATEWAY_ENV_VARS.rateLimitMaxRequests,
      GATEWAY_ENV_VARS.rateLimitWindowMs,
    ]);
    expect(configurationError.message).toContain(GATEWAY_ENV_VARS.rateLimitMaxRequests);
    expect(configurationError.message).toContain(GATEWAY_ENV_VARS.rateLimitWindowMs);
    expect(configurationError.message).not.toContain(secretMax);
    expect(configurationError.message).not.toContain(secretWindow);
    expect(configurationError.message).not.toContain("graph-api-key-should-stay-hidden");
    expect(configurationError.message).not.toContain("admin-token-should-stay-hidden");
  });

  it.each([
    [GATEWAY_ENV_VARS.rateLimitMaxRequests, GATEWAY_MAXIMUMS.rateLimitMaxRequests],
    [GATEWAY_ENV_VARS.rateLimitWindowMs, GATEWAY_MAXIMUMS.rateLimitWindowMs],
    [GATEWAY_ENV_VARS.sourceTimeoutMs, GATEWAY_MAXIMUMS.sourceTimeoutMs],
  ])("rejects %s above its practical deployment ceiling", (variableName, maximum) => {
    expect(() =>
      loadGatewayConfig({
        [variableName]: String(maximum + 1),
      }),
    ).toThrow(ConfigurationError);
  });
});

describe("parseBoundedPositiveInteger", () => {
  it.each(["1.25", "NaN", "Infinity", "-Infinity"])(
    "rejects %s without echoing the raw value",
    (raw) => {
      let error: unknown;
      try {
        parseBoundedPositiveInteger(raw, "TEST_VAR");
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigurationError);
      const configurationError = error as ConfigurationError;
      expect(configurationError.message).toContain("TEST_VAR");
      expect(configurationError.message).not.toContain(raw);
    },
  );

  it("honors a caller-supplied upper bound", () => {
    expect(parseBoundedPositiveInteger("10", "TEST_VAR", 10)).toBe(10);
    expect(() => parseBoundedPositiveInteger("11", "TEST_VAR", 10)).toThrow(ConfigurationError);
  });
});
