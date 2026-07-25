import { DecimalParseError, parseDecimal, sumDecimals } from "./decimal.js";

/**
 * Completed UTC daily snapshot as reported by a Tier-B Graph deployment.
 * `date` is the UTC midnight timestamp (unix seconds) of the day the
 * snapshot summarizes. Volume and fees are source-reported USD decimal
 * strings, or `null` when the source did not report them for that day.
 */
export interface DailySnapshot {
  readonly date: number;
  readonly volumeUSD: string | null;
  readonly feesUSD: string | null;
}

export interface WindowAggregates {
  /** Most recent completed UTC day's volume, or null if unavailable. */
  readonly volume_usd_24h: string | null;
  /** Most recent completed UTC day's fees, or null if unavailable. */
  readonly fees_usd_24h: string | null;
  /** Exact sum of seven consecutive completed UTC days, or null. */
  readonly volume_usd_7d: string | null;
  readonly fees_usd_7d: string | null;
}

export interface AggregationWarning {
  readonly code:
    | "no_completed_days"
    | "insufficient_7d_history"
    | "interior_gap"
    | "duplicate_day"
    | "too_many_days"
    | "null_metric"
    | "malformed_metric";
  readonly message: string;
}

export interface AggregationResult {
  readonly aggregates: WindowAggregates;
  readonly warnings: readonly AggregationWarning[];
}

const SECONDS_PER_DAY = 86_400;

export function utcDayId(timestampSeconds: number): number {
  return Math.floor(timestampSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

function isCompletedDay(dayId: number, referenceTimestampSeconds: number): boolean {
  return dayId + SECONDS_PER_DAY <= referenceTimestampSeconds;
}

function sortSnapshots(snapshots: readonly DailySnapshot[]): DailySnapshot[] {
  return [...snapshots].sort((a, b) => a.date - b.date);
}

function deduplicateByDate(snapshots: readonly DailySnapshot[]): {
  unique: DailySnapshot[];
  duplicates: number;
} {
  const seen = new Map<number, DailySnapshot>();
  let duplicates = 0;
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.date)) {
      duplicates += 1;
    } else {
      seen.set(snapshot.date, snapshot);
    }
  }
  return { unique: [...seen.values()], duplicates };
}

function detectInteriorGap(unique: readonly DailySnapshot[]): boolean {
  for (let i = 1; i < unique.length; i++) {
    if (unique[i]!.date - unique[i - 1]!.date !== SECONDS_PER_DAY) {
      return true;
    }
  }
  return false;
}

function sumMetric(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  try {
    return sumDecimals(values);
  } catch (error) {
    if (error instanceof DecimalParseError) {
      return null;
    }
    throw error;
  }
}

function collectMetricValues(
  days: readonly DailySnapshot[],
  field: "volumeUSD" | "feesUSD",
): { values: string[]; hadNull: boolean; hadMalformed: boolean } {
  const values: string[] = [];
  let hadNull = false;
  let hadMalformed = false;
  for (const day of days) {
    const raw = day[field];
    if (raw === null) {
      hadNull = true;
      continue;
    }
    try {
      parseDecimal(raw);
      values.push(raw);
    } catch (error) {
      if (error instanceof DecimalParseError) {
        hadMalformed = true;
      } else {
        throw error;
      }
    }
  }
  return { values, hadNull, hadMalformed };
}

/**
 * Aggregate completed UTC daily snapshots into 24h and 7d window values.
 *
 * Semantics (docs/M3_PLAN.md § Agent 3A, § Time-window semantics):
 * - the current partial UTC day is never presented as a completed 24h value;
 * - 24h = the most recent completed UTC day;
 * - 7d = exact sum of seven consecutive completed UTC days ending at the 24h day;
 * - missing, duplicated, non-consecutive, null, or malformed inputs make only
 *   the affected aggregate `null` — never a substitute or estimate.
 *
 * `referenceTimestampSeconds` anchors "current day" so tests are deterministic.
 */
export function aggregateDailySnapshots(
  snapshots: readonly DailySnapshot[],
  referenceTimestampSeconds: number,
): AggregationResult {
  const warnings: AggregationWarning[] = [];
  const empty: AggregationResult = {
    aggregates: {
      volume_usd_24h: null,
      fees_usd_24h: null,
      volume_usd_7d: null,
      fees_usd_7d: null,
    },
    warnings,
  };

  if (snapshots.length === 0) {
    warnings.push({ code: "no_completed_days", message: "No daily snapshots provided" });
    return empty;
  }

  const sorted = sortSnapshots(snapshots);
  const { unique, duplicates } = deduplicateByDate(sorted);
  if (duplicates > 0) {
    warnings.push({
      code: "duplicate_day",
      message: `${duplicates} duplicate day(s) collapsed before aggregation`,
    });
  }

  const completed = unique.filter((day) => isCompletedDay(day.date, referenceTimestampSeconds));
  if (completed.length === 0) {
    warnings.push({
      code: "no_completed_days",
      message: "No completed UTC day available before the reference timestamp",
    });
    return empty;
  }

  const hasGap = detectInteriorGap(completed);
  if (hasGap) {
    warnings.push({
      code: "interior_gap",
      message: "Completed days contain a gap; 7d window is checked independently",
    });
  }

  if (completed.length > 7) {
    warnings.push({
      code: "too_many_days",
      message: `${completed.length} completed days provided; using the 7 most recent`,
    });
  }

  const recentSeven = completed.slice(-7);
  const latestDay = completed[completed.length - 1]!;

  const volume24hValues = collectMetricValues([latestDay], "volumeUSD");
  const fees24hValues = collectMetricValues([latestDay], "feesUSD");
  const volume7dValues = collectMetricValues(recentSeven, "volumeUSD");
  const fees7dValues = collectMetricValues(recentSeven, "feesUSD");

  for (const { hadNull, hadMalformed, field } of [
    { ...volume24hValues, field: "volume_usd_24h" as const },
    { ...fees24hValues, field: "fees_usd_24h" as const },
    { ...volume7dValues, field: "volume_usd_7d" as const },
    { ...fees7dValues, field: "fees_usd_7d" as const },
  ]) {
    if (hadNull) {
      warnings.push({
        code: "null_metric",
        message: `${field} had null inputs; affected aggregate is null`,
      });
    }
    if (hadMalformed) {
      warnings.push({
        code: "malformed_metric",
        message: `${field} had malformed decimal inputs; affected aggregate is null`,
      });
    }
  }

  const sevenConsecutive =
    recentSeven.length === 7 &&
    recentSeven.every((day, i) => {
      if (i === 0) return true;
      return day.date - recentSeven[i - 1]!.date === SECONDS_PER_DAY;
    });

  const volume7d = sevenConsecutive ? sumMetric(volume7dValues.values) : null;
  const fees7d = sevenConsecutive ? sumMetric(fees7dValues.values) : null;

  if (!sevenConsecutive && completed.length >= 7) {
    warnings.push({
      code: "insufficient_7d_history",
      message: "Seven consecutive completed days are not available; 7d aggregates are null",
    });
  } else if (completed.length < 7) {
    warnings.push({
      code: "insufficient_7d_history",
      message: `Only ${completed.length} completed day(s) available; 7d aggregates are null`,
    });
  }

  return {
    aggregates: {
      volume_usd_24h: volume24hValues.values.length > 0 ? sumMetric(volume24hValues.values) : null,
      fees_usd_24h: fees24hValues.values.length > 0 ? sumMetric(fees24hValues.values) : null,
      volume_usd_7d: volume7d,
      fees_usd_7d: fees7d,
    },
    warnings,
  };
}
