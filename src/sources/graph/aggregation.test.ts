import { describe, expect, it } from "vitest";

import { aggregateDailySnapshots, utcDayId } from "./aggregation.js";
import type { DailySnapshot } from "./aggregation.js";

const DAY = 86_400;
const REF = 1_784_984_000;

function day(offset: number, volume: string | null, fees: string | null): DailySnapshot {
  return { date: utcDayId(REF) - offset * DAY, volumeUSD: volume, feesUSD: fees };
}

function sevenConsecutiveDays(): DailySnapshot[] {
  return Array.from({ length: 7 }, (_, i) => day(7 - i, "100.00", "1.00"));
}

describe("aggregateDailySnapshots — 24h", () => {
  it("maps the latest completed day to 24h volume and fees", () => {
    const result = aggregateDailySnapshots(
      [day(2, "200", "2"), day(1, "300", "3"), day(0, "999", "9")],
      REF,
    );

    expect(result.aggregates.volume_usd_24h).toBe("300");
    expect(result.aggregates.fees_usd_24h).toBe("3");
  });

  it("excludes the current partial day from 24h", () => {
    const partial = day(0, "500", "5");
    const completed = day(1, "300", "3");
    const result = aggregateDailySnapshots([completed, partial], REF);

    expect(result.aggregates.volume_usd_24h).toBe("300");
    expect(result.aggregates.fees_usd_24h).toBe("3");
  });
});

describe("aggregateDailySnapshots — 7d", () => {
  it("sums exactly seven consecutive completed days", () => {
    const result = aggregateDailySnapshots(sevenConsecutiveDays(), REF);

    expect(result.aggregates.volume_usd_7d).toBe("700");
    expect(result.aggregates.fees_usd_7d).toBe("7");
  });

  it("sums values beyond IEEE-754 precision without float loss", () => {
    const snapshots: DailySnapshot[] = [
      {
        date: utcDayId(REF) - 7 * DAY,
        volumeUSD: "1837918.971826772337839586279587621",
        feesUSD: "5513.756915480317013518758838762854",
      },
      {
        date: utcDayId(REF) - 6 * DAY,
        volumeUSD: "51474578.61622885677419282699983982",
        feesUSD: "154423.7358486865703225784809995228",
      },
      {
        date: utcDayId(REF) - 5 * DAY,
        volumeUSD: "40635517.7678439140561290160817718",
        feesUSD: "121906.5533035317421683870482453143",
      },
      {
        date: utcDayId(REF) - 4 * DAY,
        volumeUSD: "64491334.84868823906340059812757887",
        feesUSD: "193474.0045460647171902017943827393",
      },
      {
        date: utcDayId(REF) - 3 * DAY,
        volumeUSD: "34752470.9371506173065599289573975",
        feesUSD: "104257.4128114518519196797868721919",
      },
      {
        date: utcDayId(REF) - 2 * DAY,
        volumeUSD: "95158308.81850063901666160232434262",
        feesUSD: "285474.9264555019170499848069730268",
      },
      {
        date: utcDayId(REF) - 1 * DAY,
        volumeUSD: "24701335.71650390345286524940436904",
        feesUSD: "74104.00714951171035859574821310743",
      },
    ];

    const result = aggregateDailySnapshots(snapshots, REF);

    expect(result.aggregates.volume_usd_7d).toBe("313051465.676742942007648808174887271");
    expect(result.aggregates.fees_usd_7d).toBe("939154.397030228826022946424524665384");
  });

  it("validates volume and fees independently so one null does not erase the other", () => {
    const snapshots: DailySnapshot[] = Array.from({ length: 7 }, (_, i) => ({
      date: utcDayId(REF) - (7 - i) * DAY,
      volumeUSD: "100",
      feesUSD: null,
    }));

    const result = aggregateDailySnapshots(snapshots, REF);

    expect(result.aggregates.volume_usd_7d).toBe("700");
    expect(result.aggregates.fees_usd_7d).toBeNull();
  });
});

describe("aggregateDailySnapshots — ordering and gaps", () => {
  it("handles unordered snapshots", () => {
    const ordered = sevenConsecutiveDays();
    const shuffled = [
      ordered[3]!,
      ordered[0]!,
      ordered[6]!,
      ordered[1]!,
      ordered[5]!,
      ordered[2]!,
      ordered[4]!,
    ];
    const result = aggregateDailySnapshots(shuffled, REF);

    expect(result.aggregates.volume_usd_7d).toBe("700");
  });

  it("returns null 7d for only six days of history", () => {
    const six = sevenConsecutiveDays().slice(1);
    const result = aggregateDailySnapshots(six, REF);

    expect(result.aggregates.volume_usd_7d).toBeNull();
    expect(result.warnings.some((w) => w.code === "insufficient_7d_history")).toBe(true);
  });

  it("returns null 7d for an interior gap", () => {
    const days = sevenConsecutiveDays();
    days[3] = day(3, "100", "1");
    days.splice(3, 0, { date: utcDayId(REF) - 3 * DAY + DAY / 2, volumeUSD: "0", feesUSD: "0" });
    const result = aggregateDailySnapshots(days, REF);

    expect(result.aggregates.volume_usd_7d).toBeNull();
    expect(result.warnings.some((w) => w.code === "interior_gap")).toBe(true);
  });

  it("collapses a duplicate day before aggregating", () => {
    const days = sevenConsecutiveDays();
    const dup = { ...days[2]! };
    const result = aggregateDailySnapshots([...days, dup], REF);

    expect(result.aggregates.volume_usd_7d).toBe("700");
    expect(result.warnings.some((w) => w.code === "duplicate_day")).toBe(true);
  });

  it("uses only the 7 most recent when eight days are provided", () => {
    const eight = [...sevenConsecutiveDays(), day(8, "999", "9")];
    const result = aggregateDailySnapshots(eight, REF);

    expect(result.aggregates.volume_usd_7d).toBe("700");
    expect(result.warnings.some((w) => w.code === "too_many_days")).toBe(true);
  });
});

describe("aggregateDailySnapshots — null and malformed", () => {
  it("returns null 24h when the latest day has null volume but valid fees", () => {
    const result = aggregateDailySnapshots([day(1, null, "3"), day(0, "999", "9")], REF);

    expect(result.aggregates.volume_usd_24h).toBeNull();
    expect(result.aggregates.fees_usd_24h).toBe("3");
  });

  it("returns null for malformed volume but valid fees", () => {
    const result = aggregateDailySnapshots([day(1, "not-a-decimal", "3"), day(0, "999", "9")], REF);

    expect(result.aggregates.volume_usd_24h).toBeNull();
    expect(result.aggregates.fees_usd_24h).toBe("3");
    expect(result.warnings.some((w) => w.code === "malformed_metric")).toBe(true);
  });

  it("returns null for valid volume but malformed fees", () => {
    const result = aggregateDailySnapshots([day(1, "300", "bad"), day(0, "999", "9")], REF);

    expect(result.aggregates.volume_usd_24h).toBe("300");
    expect(result.aggregates.fees_usd_24h).toBeNull();
  });
});

describe("aggregateDailySnapshots — empty and partial", () => {
  it("returns all null with a warning for no snapshots", () => {
    const result = aggregateDailySnapshots([], REF);

    expect(result.aggregates).toEqual({
      volume_usd_24h: null,
      fees_usd_24h: null,
      volume_usd_7d: null,
      fees_usd_7d: null,
    });
    expect(result.warnings.some((w) => w.code === "no_completed_days")).toBe(true);
  });

  it("returns all null when only the partial current day exists", () => {
    const result = aggregateDailySnapshots([day(0, "999", "9")], REF);

    expect(result.aggregates.volume_usd_24h).toBeNull();
    expect(result.warnings.some((w) => w.code === "no_completed_days")).toBe(true);
  });
});

describe("aggregateDailySnapshots — UTC boundaries", () => {
  it("handles UTC month boundary", () => {
    const monthEnd: DailySnapshot = { date: 1_784_841_600, volumeUSD: "100", feesUSD: "1" };
    const monthStart: DailySnapshot = { date: 1_784_841_600 + DAY, volumeUSD: "200", feesUSD: "2" };
    const ref = monthStart.date + DAY;

    const result = aggregateDailySnapshots([monthEnd, monthStart], ref);

    expect(result.aggregates.volume_usd_24h).toBe("200");
  });

  it("handles UTC year boundary and leap day", () => {
    const leap: DailySnapshot = { date: 1_982_889_600, volumeUSD: "50", feesUSD: "0.5" };
    const after: DailySnapshot = { date: 1_982_889_600 + DAY, volumeUSD: "60", feesUSD: "0.6" };
    const ref = after.date + DAY;

    const result = aggregateDailySnapshots([leap, after], ref);

    expect(result.aggregates.volume_usd_24h).toBe("60");
  });
});

describe("aggregateDailySnapshots — immutability", () => {
  it("does not mutate the input array", () => {
    const input = sevenConsecutiveDays();
    const inputCopy = [...input];

    aggregateDailySnapshots(input, REF);

    expect(input).toEqual(inputCopy);
  });

  it("does not mutate input snapshot objects", () => {
    const input = sevenConsecutiveDays();
    const snapshot = input[3]!;
    const original = { ...snapshot };

    aggregateDailySnapshots(input, REF);

    expect(snapshot).toEqual(original);
  });
});
