import { describe, expect, it } from "vitest";

import {
  evaluateProgress,
  parseReadyPayload,
  parseWatchdogState,
  positiveIntegerSetting,
} from "../../scripts/m4/nuthatch-watchdog-lib.mjs";

const sample = (lastBlock, tip, ready = true, stalled = false) => ({
  ready,
  lastBlock,
  tip,
  lagBlocks: tip - lastBlock,
  reportedStalled: stalled,
});

describe("Nuthatch backfill watchdog", () => {
  it("accepts both current last_block and v0.6.1 sealed_through payloads", () => {
    expect(
      parseReadyPayload({
        ready: true,
        last_block: 49_065_709,
        tip: 49_116_811,
        stalled: false,
      }).lastBlock,
    ).toBe(49_065_709);
    expect(
      parseReadyPayload({
        ready: true,
        sealed_through: 49_065_709,
        tip: 49_116_811,
        stalled: false,
      }).lastBlock,
    ).toBe(49_065_709);
  });

  it("alerts after elapsed no-progress time even when stalled is false", () => {
    const baseline = evaluateProgress(null, sample(49_065_709, 49_116_000), 1_000, 600);
    const waiting = evaluateProgress(baseline.state, sample(49_065_709, 49_116_400), 1_599, 600);
    const alert = evaluateProgress(waiting.state, sample(49_065_709, 49_116_811), 1_600, 600);

    expect(waiting.report).toMatchObject({
      status: "ok",
      reason: "waiting",
      reported_stalled: false,
      seconds_since_progress: 599,
    });
    expect(alert.report).toMatchObject({
      status: "alert",
      reason: "no_progress",
      reported_stalled: false,
      seconds_since_progress: 600,
    });
  });

  it("resets the elapsed timer only when the high-water block advances", () => {
    const baseline = evaluateProgress(null, sample(100, 200), 1_000, 600);
    const progress = evaluateProgress(baseline.state, sample(101, 205), 1_500, 600);

    expect(progress.report).toMatchObject({
      status: "ok",
      reason: "progress",
      high_water_block: 101,
      seconds_since_progress: 0,
    });
    expect(progress.state.last_progress_at).toBe(1_500);
  });

  it("alerts immediately on block regression and preserves the high-water mark", () => {
    const baseline = evaluateProgress(null, sample(100, 200), 1_000, 600);
    const regression = evaluateProgress(baseline.state, sample(99, 205), 1_001, 600);

    expect(regression.report).toMatchObject({
      status: "alert",
      reason: "regressed",
      last_block: 99,
      high_water_block: 100,
    });
  });

  it("does not flag a caught-up indexer when the chain tip is unchanged", () => {
    const baseline = evaluateProgress(null, sample(200, 200), 1_000, 600);
    const caughtUp = evaluateProgress(baseline.state, sample(200, 200), 2_000, 600);

    expect(caughtUp.report).toMatchObject({
      status: "ok",
      reason: "caught_up",
      lag_blocks: 0,
      seconds_since_progress: 0,
    });
  });

  it("treats ready:false as an alert independently of block movement", () => {
    const baseline = evaluateProgress(null, sample(100, 200), 1_000, 600);
    const result = evaluateProgress(baseline.state, sample(101, 200, false), 1_010, 600);
    expect(result.report).toMatchObject({ status: "alert", reason: "not_ready" });
  });

  it("rejects malformed payload, state, and settings", () => {
    expect(() => parseReadyPayload({ ready: true, last_block: "1", tip: 2 })).toThrow();
    expect(() =>
      parseWatchdogState({
        version: 1,
        high_water_block: 10,
        last_block: 11,
        last_observed_at: 2,
        last_progress_at: 1,
      }),
    ).toThrow(/invariants/);
    expect(() => positiveIntegerSetting("0", 600, "STALL")).toThrow(/positive integer/);
  });
});
