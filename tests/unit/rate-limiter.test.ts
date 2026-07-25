import { describe, expect, it, vi } from "vitest";

import { GATEWAY_DEFAULTS } from "../../src/config/defaults.js";
import { ConfigurationError, RateLimitError } from "../../src/errors/index.js";
import { FixedWindowRateLimiter } from "../../src/gateway/rate-limiter.js";

function createManualClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the configured maximum", async () => {
    const clock = createManualClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 3,
      windowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      clock: clock.now,
    });
    const callback = vi.fn(() => "ok");

    await expect(limiter.execute("client", callback)).resolves.toBe("ok");
    await expect(limiter.execute("client", callback)).resolves.toBe("ok");
    await expect(limiter.execute("client", callback)).resolves.toBe("ok");
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("rejects over-limit execution without calling the downstream callback", async () => {
    const clock = createManualClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 2,
      windowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      clock: clock.now,
    });
    const allowed = vi.fn(() => "allowed");
    const rejected = vi.fn(() => "should-not-run");

    await limiter.execute("client", allowed);
    await limiter.execute("client", allowed);

    await expect(limiter.execute("client", rejected)).rejects.toBeInstanceOf(RateLimitError);
    expect(rejected).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(2);
  });

  it("resets the window after windowMs elapses on the injected clock", async () => {
    const clock = createManualClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      clock: clock.now,
    });
    const callback = vi.fn(() => "ok");

    await limiter.execute("client", callback);
    await expect(limiter.execute("client", callback)).rejects.toBeInstanceOf(RateLimitError);

    clock.advance(GATEWAY_DEFAULTS.rateLimitWindowMs - 1);
    await expect(limiter.execute("client", callback)).rejects.toBeInstanceOf(RateLimitError);

    clock.advance(1);

    await expect(limiter.execute("client", callback)).resolves.toBe("ok");
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("prunes expired keys on the next cleanup boundary", async () => {
    const clock = createManualClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      clock: clock.now,
    });

    await limiter.execute("a", () => "a");
    await limiter.execute("b", () => "b");
    await limiter.execute("c", () => "c");
    expect(limiter.trackedKeyCount).toBe(3);

    clock.advance(GATEWAY_DEFAULTS.rateLimitWindowMs);
    await limiter.execute("d", () => "d");

    expect(limiter.trackedKeyCount).toBe(1);
  });

  it("tracks keys independently", async () => {
    const clock = createManualClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: GATEWAY_DEFAULTS.rateLimitWindowMs,
      clock: clock.now,
    });

    await expect(limiter.execute("a", () => "a")).resolves.toBe("a");
    await expect(limiter.execute("b", () => "b")).resolves.toBe("b");
    await expect(limiter.execute("a", () => "again")).rejects.toBeInstanceOf(RateLimitError);
  });

  it.each([
    ["fractional maxRequests", { maxRequests: 1.5, windowMs: 1_000 }],
    ["NaN maxRequests", { maxRequests: Number.NaN, windowMs: 1_000 }],
    ["infinite maxRequests", { maxRequests: Number.POSITIVE_INFINITY, windowMs: 1_000 }],
    ["fractional windowMs", { maxRequests: 1, windowMs: 10.5 }],
    ["NaN windowMs", { maxRequests: 1, windowMs: Number.NaN }],
    ["infinite windowMs", { maxRequests: 1, windowMs: Number.POSITIVE_INFINITY }],
    ["zero maxRequests", { maxRequests: 0, windowMs: 1_000 }],
    ["negative windowMs", { maxRequests: 1, windowMs: -1 }],
  ])("rejects invalid configuration: %s", (_label, options) => {
    expect(() => new FixedWindowRateLimiter(options)).toThrow(ConfigurationError);
  });
});
