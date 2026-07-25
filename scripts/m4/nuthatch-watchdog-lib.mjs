const NON_NEGATIVE_INTEGER = /^\d+$/;

function requireNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

export function positiveIntegerSetting(value, fallback, name) {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!NON_NEGATIVE_INTEGER.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function parseReadyPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("/ready must return a JSON object.");
  }

  const lastBlock =
    value.last_block === undefined
      ? requireNonNegativeInteger(value.sealed_through, "sealed_through")
      : requireNonNegativeInteger(value.last_block, "last_block");
  const tip = requireNonNegativeInteger(value.tip, "tip");
  if (tip < lastBlock) {
    throw new Error("/ready tip must not be behind last_block.");
  }
  if (typeof value.ready !== "boolean") {
    throw new Error("/ready ready must be a boolean.");
  }

  return {
    ready: value.ready,
    lastBlock,
    tip,
    lagBlocks: tip - lastBlock,
    reportedStalled: typeof value.stalled === "boolean" ? value.stalled : null,
  };
}

export function parseWatchdogState(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Watchdog state must be a JSON object.");
  }
  if (value.version !== 1) {
    throw new Error("Watchdog state version is unsupported.");
  }

  const state = {
    version: 1,
    high_water_block: requireNonNegativeInteger(value.high_water_block, "high_water_block"),
    last_block: requireNonNegativeInteger(value.last_block, "last_block"),
    last_observed_at: requireNonNegativeInteger(value.last_observed_at, "last_observed_at"),
    last_progress_at: requireNonNegativeInteger(value.last_progress_at, "last_progress_at"),
  };
  if (
    state.last_block > state.high_water_block ||
    state.last_progress_at > state.last_observed_at
  ) {
    throw new Error("Watchdog state invariants are invalid.");
  }
  return state;
}

export function evaluateProgress(previous, sample, observedAt, stallAfterSeconds) {
  requireNonNegativeInteger(observedAt, "observedAt");
  requireNonNegativeInteger(stallAfterSeconds, "stallAfterSeconds");
  if (stallAfterSeconds === 0) {
    throw new Error("stallAfterSeconds must be positive.");
  }
  if (previous !== null && observedAt < previous.last_observed_at) {
    throw new Error("Watchdog clock moved backwards.");
  }

  const highWater = Math.max(previous?.high_water_block ?? sample.lastBlock, sample.lastBlock);
  const progressed = previous !== null && sample.lastBlock > previous.high_water_block;
  const caughtUp = sample.lagBlocks === 0;
  const lastProgressAt =
    previous === null || progressed || caughtUp ? observedAt : previous.last_progress_at;
  const secondsSinceProgress = observedAt - lastProgressAt;
  const regressed = previous !== null && sample.lastBlock < previous.high_water_block;
  const noProgress =
    previous !== null && !caughtUp && !regressed && secondsSinceProgress >= stallAfterSeconds;

  let reason = "waiting";
  if (previous === null) {
    reason = "baseline";
  } else if (regressed) {
    reason = "regressed";
  } else if (progressed) {
    reason = "progress";
  } else if (caughtUp) {
    reason = "caught_up";
  } else if (noProgress) {
    reason = "no_progress";
  }

  const alert = !sample.ready || regressed || noProgress;
  return {
    state: {
      version: 1,
      high_water_block: highWater,
      last_block: sample.lastBlock,
      last_observed_at: observedAt,
      last_progress_at: lastProgressAt,
    },
    report: {
      event: "nuthatch_backfill_watchdog",
      status: alert ? "alert" : "ok",
      reason: !sample.ready ? "not_ready" : reason,
      ready: sample.ready,
      reported_stalled: sample.reportedStalled,
      last_block: sample.lastBlock,
      high_water_block: highWater,
      tip: sample.tip,
      lag_blocks: sample.lagBlocks,
      seconds_since_progress: secondsSinceProgress,
    },
  };
}
