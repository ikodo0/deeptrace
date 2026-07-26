import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { normalizeLssSwapEvent } from "../../src/normalization/index.js";
import { getSourceById } from "../../src/registry/index.js";
import type { NuthatchSourceRegistryRecord } from "../../src/registry/types.js";
import { LSS_SCOPE } from "../../src/scope/index.js";
import {
  fetchNuthatchLargeSwapCandidates,
  largeSwapSourceProvenance,
} from "../../src/sources/nuthatch/large-swaps-adapter.js";
import {
  buildLargeSwapHeadQuery,
  buildLargeSwapScanQuery,
} from "../../src/sources/nuthatch/large-swaps-query.js";
import {
  parseLargeSwapReady,
  parseLargeSwapReceipt,
  type NuthatchLargeSwapRow,
} from "../../src/sources/nuthatch/large-swaps-response.js";
import type { NuthatchClient, NuthatchHttpResult } from "../../src/sources/nuthatch/client.js";
import type { LargeSwapSourceGateway } from "../../src/tools/index.js";
import { executeFindLargeSwaps, inspectLargeSwapQuery } from "../../src/tools/index.js";
import { lockedLargeSwapsRequest } from "../fixtures/large-swaps-request.js";

const REGISTRY_HASH = "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25";
const HEAD_TIMESTAMP = 1_784_678_093;

function record(): NuthatchSourceRegistryRecord {
  const value = getSourceById(LSS_SCOPE.source.sourceId);
  if (value?.source_type !== "nuthatch_view") {
    throw new Error("missing LSS Nuthatch registry record");
  }
  return value;
}

function row(
  nibble: string,
  blockNumber: number,
  logIndex: number,
  amount0Raw = "-6123995143586742520",
  amount1Raw = "11804868893",
): NuthatchLargeSwapRow {
  return {
    pool_address: LSS_SCOPE.poolAddress,
    block_number: blockNumber,
    block_hash: `0x${nibble.repeat(64)}`,
    block_timestamp: HEAD_TIMESTAMP - (48_944_373 - blockNumber) * 2,
    transaction_hash: `0x${nibble.repeat(64)}`,
    log_index: logIndex,
    amount0_raw: amount0Raw,
    amount1_raw: amount1Raw,
  };
}

function receipt(rows: readonly NuthatchLargeSwapRow[], asOf = 48_944_374) {
  return {
    count: rows.length,
    provenance: {
      as_of: asOf,
      registry_hash: REGISTRY_HASH,
      sealed_through: asOf,
      source: "hot+sealed",
    },
    rows,
    truncated: false,
  };
}

function ok(body: unknown): NuthatchHttpResult {
  return { ok: true, status: 200, body, latencyMs: 1 };
}

function clientFor(rows: readonly NuthatchLargeSwapRow[]) {
  const head = rows[0] ?? row("a", 48_944_373, 1);
  const sqlQueries: string[] = [];
  const client: NuthatchClient = {
    health: vi.fn(() => Promise.resolve(ok({ status: "ok" }))),
    ready: vi.fn(() =>
      Promise.resolve(ok({ ready: true, sealed_through: 48_944_374, tip: 48_944_374 })),
    ),
    nest: vi.fn(() => Promise.resolve(ok({ registry_hash: REGISTRY_HASH, name: "deeptrace" }))),
    schema: vi.fn(() => Promise.resolve(ok("Nuthatch schema"))),
    explain: vi.fn(() => Promise.resolve(ok({ valid: true }))),
    sql: vi.fn((query: string, maxRows: number) => {
      sqlQueries.push(query);
      if (sqlQueries.length === 1) {
        return Promise.resolve(ok(receipt([head])));
      }

      const snapshotMatch = /WHERE block_number <= (\d+)/.exec(query);
      const snapshotHead = snapshotMatch === null ? -1 : Number(snapshotMatch[1]);
      const candidates = rows.filter(({ block_number }) => block_number <= snapshotHead);
      const anchorMatch = /CAST\(transaction_hash AS VARCHAR\) (>=|>) '(0x[0-9a-f]{64})'/.exec(
        query,
      );
      if (anchorMatch === null) {
        return Promise.resolve(ok(receipt(candidates.slice(0, maxRows))));
      }

      const [, operator, transactionHash] = anchorMatch;
      const anchorIndex = candidates.findIndex(
        ({ transaction_hash }) => transaction_hash === transactionHash,
      );
      const start = anchorIndex < 0 ? candidates.length : anchorIndex + (operator === ">" ? 1 : 0);
      return Promise.resolve(ok(receipt(candidates.slice(start, start + maxRows))));
    }),
  };
  return { client, sqlQueries };
}

describe("Nuthatch large-swap query boundary", () => {
  it("builds deterministic keyset SQL from validated coordinates only", () => {
    const query = buildLargeSwapScanQuery({
      snapshotHead: 100,
      after: {
        block_number: 99,
        log_index: 7,
        transaction_hash: `0x${"a".repeat(64)}`,
      },
      includeAfter: false,
      limit: 25,
    });

    expect(query).toContain("FROM pool_swap_search");
    expect(query).toContain("block_number <= 100");
    expect(query).toContain("block_number < 99");
    expect(query).toContain(`CAST(transaction_hash AS VARCHAR) > '0x${"a".repeat(64)}'`);
    expect(query).toContain("LIMIT 25");
    expect(query).not.toContain(lockedLargeSwapsRequest.min_amount);
    expect(query).not.toContain(LSS_SCOPE.tokens.weth.address);
  });

  it("rejects unsafe coordinates instead of interpolating them", () => {
    expect(() => buildLargeSwapHeadQuery(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() =>
      buildLargeSwapScanQuery({
        snapshotHead: 100,
        after: {
          block_number: 99,
          log_index: 7,
          transaction_hash: "0x' OR 1=1 --",
        },
        includeAfter: false,
        limit: 25,
      }),
    ).toThrow();
  });

  it("rejects truncated, mismatched, and out-of-snapshot receipts", () => {
    const validRows = [row("a", 48_944_373, 8)];
    expect(
      parseLargeSwapReceipt({ ...receipt(validRows), truncated: true }, REGISTRY_HASH),
    ).toBeNull();
    expect(parseLargeSwapReceipt({ ...receipt(validRows), count: 2 }, REGISTRY_HASH)).toBeNull();
    expect(parseLargeSwapReceipt(receipt(validRows, 48_944_372), REGISTRY_HASH)).toBeNull();
    expect(parseLargeSwapReceipt(receipt(validRows), `0x${"f".repeat(64)}`)).toBeNull();
    expect(
      parseLargeSwapReceipt(
        receipt([{ ...validRows[0]!, amount0_raw: "1".repeat(80) }]),
        REGISTRY_HASH,
      ),
    ).toBeNull();
  });
});

describe("Nuthatch large-swap adapter", () => {
  it("returns exact threshold candidates and fixed source provenance", async () => {
    const rows = [
      row("a", 48_944_373, 8),
      row("b", 48_944_372, 7, "-500000000000000000", "900000000"),
    ];
    const { client, sqlQueries } = clientFor(rows);
    const result = await fetchNuthatchLargeSwapCandidates(
      { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
      inspectLargeSwapQuery({
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.usdc.address,
        min_amount: "10000",
        limit: 1,
      }),
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected source success");
    }
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.amount_in).toBe("11804.868893");
    expect(result.indexedHead).toBe(48_944_373);
    expect(result.provenance).toEqual(largeSwapSourceProvenance(record()));
    expect(result.freshness).toMatchObject({
      status: "fresh",
      indexed_block: 48_944_373,
      indexed_block_hash: `0x${"a".repeat(64)}`,
    });
    expect(sqlQueries).toHaveLength(2);
    expect(sqlQueries.every((query) => !query.includes("10000"))).toBe(true);
  });

  it("returns a successful empty candidate window when no event meets the threshold", async () => {
    const rows = [row("a", 48_944_373, 8, "-500000000000000000", "900000000")];
    const { client } = clientFor(rows);
    const result = await fetchNuthatchLargeSwapCandidates(
      { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
      inspectLargeSwapQuery({
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.usdc.address,
        min_amount: "10000",
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.events).toEqual([]);
  });

  it("contains unsupported receipts and stale heads as source failures", async () => {
    const { client } = clientFor([row("a", 48_944_373, 8)]);
    client.nest = vi.fn(() => Promise.resolve(ok({ registry_hash: `0x${"f".repeat(64)}` })));
    const mismatch = await fetchNuthatchLargeSwapCandidates(
      { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
      inspectLargeSwapQuery(lockedLargeSwapsRequest),
    );
    expect(mismatch).toMatchObject({ status: "unsupported", events: null });

    const staleClient = clientFor([row("a", 48_944_373, 8)]).client;
    const stale = await fetchNuthatchLargeSwapCandidates(
      {
        client: staleClient,
        clock: () => HEAD_TIMESTAMP + 301,
        record: record(),
      },
      inspectLargeSwapQuery(lockedLargeSwapsRequest),
    );
    expect(stale).toMatchObject({ status: "stale", events: null });
  });

  it("classifies canonical swap-shape drift as unsupported", async () => {
    const { client } = clientFor([row("a", 48_944_373, 8, "500000000000000000", "900000000")]);
    const result = await fetchNuthatchLargeSwapCandidates(
      { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
      inspectLargeSwapQuery(lockedLargeSwapsRequest),
    );

    expect(result).toMatchObject({
      status: "unsupported",
      events: null,
      warnings: ["Large-swap receipt violates canonical swap semantics."],
    });
  });

  it("advances exclusive keysets across sparse internal scan batches", async () => {
    const matchIndexes = new Set([10, 300, 600]);
    const rows = Array.from({ length: 700 }, (_, index) => {
      const hex = index.toString(16).padStart(64, "0");
      return {
        ...row(
          "a",
          48_944_373 - index,
          700 - index,
          matchIndexes.has(index) ? "-2000000000000000000" : "-500000000000000000",
          "900000000",
        ),
        block_hash: `0x${hex}`,
        transaction_hash: `0x${hex}`,
      };
    });
    const { client, sqlQueries } = clientFor(rows);
    const result = await fetchNuthatchLargeSwapCandidates(
      { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
      inspectLargeSwapQuery({
        ...lockedLargeSwapsRequest,
        threshold_token: LSS_SCOPE.tokens.weth.address,
        min_amount: "1",
        limit: 2,
      }),
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected source success");
    }
    expect(result.events.map(({ transaction_hash }) => transaction_hash)).toEqual(
      [...matchIndexes].map((index) => rows[index]!.transaction_hash),
    );
    expect(sqlQueries).toHaveLength(4);
    expect(sqlQueries[2]).toContain(
      `CAST(transaction_hash AS VARCHAR) > '${rows[255]!.transaction_hash}'`,
    );
    expect(sqlQueries[3]).toContain(
      `CAST(transaction_hash AS VARCHAR) > '${rows[511]!.transaction_hash}'`,
    );
  });

  it("preserves every event exactly once across live-adapter cursor pages", async () => {
    const rows = Array.from({ length: 300 }, (_, index) => {
      const hex = index.toString(16).padStart(64, "0");
      return {
        ...row("a", 48_944_373 - index, 300 - index),
        block_hash: `0x${hex}`,
        transaction_hash: `0x${hex}`,
      };
    });
    const { client, sqlQueries } = clientFor(rows);
    const source: LargeSwapSourceGateway = {
      provenance: largeSwapSourceProvenance(record()),
      fetchCandidates: (context) =>
        fetchNuthatchLargeSwapCandidates(
          { client, clock: () => HEAD_TIMESTAMP + 60, record: record() },
          context,
        ),
    };
    const request = {
      ...lockedLargeSwapsRequest,
      threshold_token: LSS_SCOPE.tokens.weth.address,
      min_amount: "1",
      limit: 100,
    } as const;

    const swaps = [];
    const continuationAnchors: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await executeFindLargeSwaps({ ...request, cursor }, source);
      expect(response.status).toBe("complete");
      if (response.status !== "complete") {
        throw new Error("expected complete page");
      }
      swaps.push(...response.data.swaps);
      cursor = response.pagination.next_cursor;
      if (cursor !== null) {
        const last = response.data.swaps.at(-1);
        if (last === undefined) {
          throw new Error("expected a cursor anchor");
        }
        continuationAnchors.push(last.transaction_hash);
      }
    } while (cursor !== null);

    expect(swaps.map(({ transaction_hash }) => transaction_hash)).toEqual(
      rows.map(({ transaction_hash }) => transaction_hash),
    );
    expect(new Set(swaps.map(({ transaction_hash }) => transaction_hash)).size).toBe(rows.length);
    expect(sqlQueries.some((query) => query.includes("block_number <= 48944373"))).toBe(true);
    expect(continuationAnchors.length).toBeGreaterThan(1);
    expect(
      continuationAnchors.every((anchor) =>
        sqlQueries.some((query) =>
          query.includes(`CAST(transaction_hash AS VARCHAR) >= '${anchor}'`),
        ),
      ),
    ).toBe(true);
  });
});

describe("retained Nuthatch receipt parity", () => {
  it("maps the retained live row to the committed canonical swap exactly", () => {
    const evidence = JSON.parse(
      readFileSync(
        new URL(
          "../integration/__evidence__/lss/nuthatch-large-swaps-receipt.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      ready: unknown;
      receipt: unknown;
      expected_swap: unknown;
    };
    expect(parseLargeSwapReady(evidence.ready)).toEqual({
      ready: true,
      indexedHead: 48_944_374,
      tip: 48_944_374,
    });
    const parsed = parseLargeSwapReceipt(evidence.receipt, REGISTRY_HASH);
    expect(parsed).not.toBeNull();
    const raw = parsed!.rows[0]!;
    expect(
      normalizeLssSwapEvent({
        chain_id: LSS_SCOPE.chainId,
        protocol: LSS_SCOPE.protocol,
        pool: raw.pool_address,
        transaction_hash: raw.transaction_hash,
        log_index: raw.log_index,
        block_number: raw.block_number,
        timestamp: raw.block_timestamp,
        amount0_raw: raw.amount0_raw,
        amount1_raw: raw.amount1_raw,
        source_id: LSS_SCOPE.source.sourceId,
      }),
    ).toEqual(evidence.expected_swap);
  });
});
