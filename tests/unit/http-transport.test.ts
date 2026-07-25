import { describe, expect, it } from "vitest";

import { isAuthorized } from "../../src/http/auth.js";
import {
  HTTP_DEFAULTS,
  HTTP_ENV_VARS,
  HTTP_MAXIMUMS,
  MIN_TOKEN_LENGTH,
  loadHttpConfig,
} from "../../src/http/config.js";
import { ConfigurationError } from "../../src/errors/index.js";

const VALID_TOKEN = "a".repeat(MIN_TOKEN_LENGTH);

describe("loadHttpConfig", () => {
  it("returns documented defaults when only the token is supplied", () => {
    expect(loadHttpConfig({ [HTTP_ENV_VARS.token]: VALID_TOKEN })).toEqual({
      host: HTTP_DEFAULTS.host,
      port: HTTP_DEFAULTS.port,
      token: VALID_TOKEN,
    });
  });

  it("applies valid overrides", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.host]: "0.0.0.0",
        [HTTP_ENV_VARS.port]: "9000",
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({ host: "0.0.0.0", port: 9_000, token: VALID_TOKEN });
  });

  it("accepts the highest bindable port", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.port]: String(HTTP_MAXIMUMS.port),
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }).port,
    ).toBe(HTTP_MAXIMUMS.port);
  });

  it("treats blank overrides as absent", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.host]: "   ",
        [HTTP_ENV_VARS.port]: "  ",
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({ host: HTTP_DEFAULTS.host, port: HTTP_DEFAULTS.port, token: VALID_TOKEN });
  });

  it("rejects a missing token", () => {
    expect(() => loadHttpConfig({})).toThrow(ConfigurationError);
  });

  it("rejects a token shorter than the minimum length", () => {
    expect(() =>
      loadHttpConfig({ [HTTP_ENV_VARS.token]: "a".repeat(MIN_TOKEN_LENGTH - 1) }),
    ).toThrow(ConfigurationError);
  });

  it("names every invalid variable", () => {
    try {
      loadHttpConfig({ [HTTP_ENV_VARS.port]: "0" });
      expect.unreachable("expected ConfigurationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variableNames).toEqual([
        HTTP_ENV_VARS.port,
        HTTP_ENV_VARS.token,
      ]);
    }
  });
});

describe("isAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorized(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(undefined, VALID_TOKEN)).toBe(false);
  });

  it("rejects a token that differs only in the final byte", () => {
    expect(isAuthorized(`Bearer ${"a".repeat(MIN_TOKEN_LENGTH - 1)}b`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(isAuthorized(`Bearer ${VALID_TOKEN}extra`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a non-bearer scheme carrying the right secret", () => {
    expect(isAuthorized(`Basic ${VALID_TOKEN}`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a bare token with no scheme", () => {
    expect(isAuthorized(VALID_TOKEN, VALID_TOKEN)).toBe(false);
  });
});
