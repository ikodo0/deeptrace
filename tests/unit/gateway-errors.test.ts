import { describe, expect, it } from "vitest";

import {
  ApplicationError,
  ConfigurationError,
  ErrorCode,
  RateLimitError,
} from "../../src/errors/index.js";

describe("typed application errors", () => {
  it("exposes stable codes for configuration and rate-limit failures", () => {
    const configurationError = new ConfigurationError(["DEEPTRACE_SOURCE_TIMEOUT_MS"]);
    const rateLimitError = new RateLimitError();

    expect(configurationError).toBeInstanceOf(ApplicationError);
    expect(configurationError.code).toBe(ErrorCode.INVALID_CONFIGURATION);
    expect(rateLimitError).toBeInstanceOf(ApplicationError);
    expect(rateLimitError.code).toBe(ErrorCode.RATE_LIMITED);
  });

  it("formats configuration errors with variable names only", () => {
    const secret = "super-secret-value";
    const error = new ConfigurationError(["GRAPH_API_KEY", "NUTHATCH_ADMIN_TOKEN"]);

    expect(error.message).toBe("Invalid configuration for GRAPH_API_KEY, NUTHATCH_ADMIN_TOKEN");
    expect(error.message).not.toContain(secret);
    expect(error.variableNames).toEqual(["GRAPH_API_KEY", "NUTHATCH_ADMIN_TOKEN"]);
  });

  it("keeps RateLimitError messages free of configuration secrets", () => {
    const secret = "Bearer sk-live-should-never-appear";
    const error = new RateLimitError();

    expect(error.message).toBe("Rate limit exceeded");
    expect(error.message).not.toContain(secret);
  });

  it("does not accept caller-provided rate-limit messages", () => {
    expect(RateLimitError).toHaveLength(0);
    expect(new RateLimitError().message).toBe("Rate limit exceeded");
  });
});
