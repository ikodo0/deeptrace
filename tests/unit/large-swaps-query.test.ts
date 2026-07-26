import { describe, expect, it } from "vitest";

import {
  LargeSwapCursorError,
  LargeSwapQueryError,
  queryLargeSwapPage,
} from "../../src/tools/index.js";
import { swapEventIdentity } from "../../src/normalization/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";
import type { SwapEvent } from "../../src/schemas/index.js";
import { usdcToWethSwapFixture, wethToUsdcSwapFixture } from "../fixtures/large-swaps.js";
import {
  fixtureLargeSwapCursor,
  lockedLargeSwapsRequest,
} from "../fixtures/large-swaps-request.js";

const CURSOR_PREFIX = `lss:v${String(LSS_SCOPE.cursor.version)}:`;

function identity(value: SwapEvent): string {
  return swapEventIdentity(value.chain_id, value.transaction_hash, value.log_index);
}

function event(
  transactionNibble: string,
  blockNumber: number,
  logIndex: number,
  amountRaw = "2500000000000000000",
): SwapEvent {
  return {
    ...wethToUsdcSwapFixture,
    transaction_hash: `0x${transactionNibble.repeat(64)}`,
    block_number: blockNumber,
    log_index: logIndex,
    amount_in:
      amountRaw === "500000000000000000"
        ? "0.5"
        : amountRaw === "1500000000000000000"
          ? "1.5"
          : "2.5",
    amount_in_raw: amountRaw,
  };
}

function rewriteCursor(
  cursor: string,
  mutate: (payload: Record<string, unknown>) => Record<string, unknown>,
): string {
  const encoded = cursor.slice(CURSOR_PREFIX.length);
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(mutate(payload)), "utf8").toString(
    "base64url",
  )}`;
}

function firstPageCursor(events: readonly SwapEvent[] = [event("a", 105, 4), event("b", 104, 3)]) {
  const page = queryLargeSwapPage({
    events,
    indexedHead: 105,
    request: {
      ...lockedLargeSwapsRequest,
      min_amount: "1.5",
      limit: 1,
    },
  });
  expect(page.pagination.next_cursor).not.toBeNull();
  return page.pagination.next_cursor!;
}

describe("large swap page ordering and thresholds", () => {
  it("orders by block desc, log desc, then transaction hash", () => {
    const ordered = queryLargeSwapPage({
      events: [event("d", 100, 7), event("a", 100, 5), event("b", 101, 1), event("c", 100, 7)],
      indexedHead: 101,
      request: {
        ...lockedLargeSwapsRequest,
        min_amount: "1",
      },
    });

    expect(ordered.swaps.map(identity)).toEqual([
      identity(event("b", 101, 1)),
      identity(event("c", 100, 7)),
      identity(event("d", 100, 7)),
      identity(event("a", 100, 5)),
    ]);
  });

  it("deduplicates events and excludes values below the exact threshold", () => {
    const exact = event("a", 100, 3, "1500000000000000000");
    const below = event("b", 99, 2, "500000000000000000");
    const page = queryLargeSwapPage({
      events: [exact, { ...exact }, below],
      indexedHead: 100,
      request: {
        ...lockedLargeSwapsRequest,
        min_amount: "1.5",
      },
    });

    expect(page.swaps).toEqual([exact]);
    expect(page.pagination).toEqual({
      limit: 25,
      returned: 1,
      has_more: false,
      next_cursor: null,
    });
  });

  it("excludes events above the first-page indexed head", () => {
    const page = queryLargeSwapPage({
      events: [event("a", 101, 1), event("b", 100, 1)],
      indexedHead: 100,
      request: {
        ...lockedLargeSwapsRequest,
        min_amount: "1",
      },
    });

    expect(page.snapshot_head).toBe(100);
    expect(page.swaps).toEqual([event("b", 100, 1)]);
  });
});

describe("large swap fixed-snapshot pagination", () => {
  it("returns stable pages without duplicates, omissions, or newly indexed blocks", () => {
    const original = [
      event("a", 105, 4),
      event("b", 104, 3),
      event("c", 103, 2),
      event("d", 102, 1),
    ];
    const first = queryLargeSwapPage({
      events: original,
      indexedHead: 105,
      request: {
        ...lockedLargeSwapsRequest,
        min_amount: "1",
        limit: 2,
      },
    });

    expect(first.swaps).toEqual(original.slice(0, 2));
    expect(first.pagination.has_more).toBe(true);
    expect(first.pagination.next_cursor).toMatch(/^lss:v1:[A-Za-z0-9_-]+$/);

    const second = queryLargeSwapPage({
      events: [event("e", 106, 9), ...original],
      indexedHead: 106,
      request: {
        ...lockedLargeSwapsRequest,
        min_amount: "1",
        limit: 2,
        cursor: first.pagination.next_cursor,
      },
    });

    expect(second.snapshot_head).toBe(105);
    expect(second.swaps).toEqual(original.slice(2));
    expect(second.pagination).toEqual({
      limit: 2,
      returned: 2,
      has_more: false,
      next_cursor: null,
    });
    expect(new Set([...first.swaps, ...second.swaps].map(identity)).size).toBe(4);
  });

  it("rejects a source head behind the frozen snapshot", () => {
    const cursor = firstPageCursor();
    expect(() =>
      queryLargeSwapPage({
        events: [event("a", 105, 4), event("b", 104, 3)],
        indexedHead: 104,
        request: {
          ...lockedLargeSwapsRequest,
          min_amount: "1.5",
          limit: 1,
          cursor,
        },
      }),
    ).toThrow(LargeSwapCursorError);
  });

  it("rejects a cursor whose anchor is unavailable", () => {
    const cursor = firstPageCursor();
    expect(() =>
      queryLargeSwapPage({
        events: [event("b", 104, 3)],
        indexedHead: 105,
        request: {
          ...lockedLargeSwapsRequest,
          min_amount: "1.5",
          limit: 1,
          cursor,
        },
      }),
    ).toThrow(LargeSwapCursorError);
  });
});

describe("large swap cursor validation", () => {
  it("decodes the checked-in v1 continuation fixture", () => {
    const page = queryLargeSwapPage({
      events: [usdcToWethSwapFixture],
      indexedHead: 20_000_100,
      request: {
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.usdc.address,
        min_amount: "2500",
        cursor: fixtureLargeSwapCursor,
      },
    });

    expect(page.snapshot_head).toBe(20_000_100);
    expect(page.swaps).toEqual([]);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it("rejects malformed and unsupported-version cursors", () => {
    for (const cursor of [
      "not-a-cursor",
      "lss:v1:%%%",
      "lss:v2:eyJub3QiOiJzdXBwb3J0ZWQifQ",
      `${CURSOR_PREFIX}${Buffer.from("{", "utf8").toString("base64url")}`,
    ]) {
      expect(() =>
        queryLargeSwapPage({
          events: [],
          indexedHead: 105,
          request: {
            ...lockedLargeSwapsRequest,
            min_amount: "1.5",
            cursor,
          },
        }),
      ).toThrow(LargeSwapCursorError);
    }
  });

  it("rejects threshold-token and minimum-amount scope mismatches", () => {
    const cursor = firstPageCursor();

    for (const request of [
      {
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.usdc.address,
        min_amount: "1.5",
        cursor,
      },
      {
        ...lockedLargeSwapsRequest,
        min_amount: "1.50",
        cursor,
      },
    ]) {
      expect(() =>
        queryLargeSwapPage({
          events: [event("a", 105, 4), event("b", 104, 3)],
          indexedHead: 105,
          request,
        }),
      ).toThrow(LargeSwapCursorError);
    }
  });

  it("rejects tampered chain, pool, and extra cursor fields", () => {
    const cursor = firstPageCursor();
    const tampered = [
      rewriteCursor(cursor, (payload) => ({ ...payload, chain_id: 1 })),
      rewriteCursor(cursor, (payload) => ({
        ...payload,
        pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })),
      rewriteCursor(cursor, (payload) => ({ ...payload, injected_sql: "select *" })),
    ];

    for (const value of tampered) {
      expect(() =>
        queryLargeSwapPage({
          events: [event("a", 105, 4), event("b", 104, 3)],
          indexedHead: 105,
          request: {
            ...lockedLargeSwapsRequest,
            min_amount: "1.5",
            cursor: value,
          },
        }),
      ).toThrow(LargeSwapCursorError);
    }
  });

  it("rejects invalid requests and oversized cursor input before paging", () => {
    expect(() =>
      queryLargeSwapPage({
        events: [],
        indexedHead: 105,
        request: {
          ...lockedLargeSwapsRequest,
          min_amount: "0",
        },
      }),
    ).toThrow(LargeSwapQueryError);

    expect(() =>
      queryLargeSwapPage({
        events: [],
        indexedHead: 105,
        request: {
          ...lockedLargeSwapsRequest,
          min_amount: "1",
          cursor: "x".repeat(LSS_SCOPE.cursor.maximumLength + 1),
        },
      }),
    ).toThrow(LargeSwapQueryError);
  });
});
