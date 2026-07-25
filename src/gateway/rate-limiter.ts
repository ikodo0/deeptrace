import { RateLimitError } from "../errors/application-error.js";
import { assertBoundedPositiveInteger } from "../config/positive-integer.js";
import { systemClock, type Clock } from "./clock.js";

export interface FixedWindowRateLimiterOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly clock?: Clock;
}

interface WindowState {
  windowStartMs: number;
  count: number;
}

/**
 * In-memory fixed-window rate limiter with an injected clock.
 * Rejected executions throw RateLimitError and never invoke the callback.
 */
export class FixedWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly windows = new Map<string, WindowState>();
  private lastCleanupMs: number | undefined;

  constructor(options: FixedWindowRateLimiterOptions) {
    this.maxRequests = assertBoundedPositiveInteger(options.maxRequests, "maxRequests");
    this.windowMs = assertBoundedPositiveInteger(options.windowMs, "windowMs");
    this.clock = options.clock ?? systemClock;
  }

  get trackedKeyCount(): number {
    return this.windows.size;
  }

  async execute<T>(key: string, callback: () => T | Promise<T>): Promise<T> {
    const now = this.clock();
    this.pruneExpiredWindows(now);
    const state = this.windows.get(key);

    if (state === undefined || now - state.windowStartMs >= this.windowMs) {
      this.windows.set(key, { windowStartMs: now, count: 1 });
      return await callback();
    }

    if (state.count >= this.maxRequests) {
      throw new RateLimitError();
    }

    state.count += 1;
    return await callback();
  }

  private pruneExpiredWindows(now: number): void {
    if (this.lastCleanupMs !== undefined && now - this.lastCleanupMs < this.windowMs) {
      return;
    }

    for (const [key, state] of this.windows) {
      if (now - state.windowStartMs >= this.windowMs) {
        this.windows.delete(key);
      }
    }

    this.lastCleanupMs = now;
  }
}
