import { describe, expect, it } from "vitest";

import { fetchNuthatchFreshness } from "./adapter.js";
import {
  BLOCK_HASH,
  err,
  NEST_OK,
  POOL,
  QUERIED_AT,
  RECORD,
  READY_OK,
  REGISTRY_HASH,
  ROW,
  run,
  SCHEMA_OK,
  scriptClient,
  SQL_OK,
} from "./adapter-fixtures.js";
import { NUTHATCH_FRESHNESS_QUERY, NUTHATCH_FRESHNESS_QUERY_ID } from "./freshness-query.js";
import type { NuthatchClient, NuthatchHttpResult } from "./client.js";

describe("fetchNuthatchFreshness — ok path", () => {
  it("returns ok with normalized row, freshness, and provenance", async () => {
    const result = await run({});
    expect(result.source_id).toBe("nuthatch-pool-swaps");
    expect(result.source_type).toBe("nuthatch_view");
    expect(result.protocol).toBe("uniswap-v3");
    expect(result.chain_id).toBe(8453);
    expect(result.status).toBe("ok");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    if (result.status !== "ok") {
      return;
    }
    expect(result.data).toEqual({
      pool_address: POOL,
      recent_swap_count_24h: 42,
      last_swap_block: 48756852,
      last_swap_block_timestamp: 1784303051,
      last_swap_block_hash: BLOCK_HASH,
      last_swap_tx_hash: "0x5a02a9e244c5191381b04066377bd9b06cec47b962074200dc0d9a4702357733",
      last_swap_log_index: 21,
    });
    expect(result.freshness).toEqual({
      indexed_block: 48756852,
      indexed_block_timestamp: 1784303051,
      indexed_block_hash: BLOCK_HASH,
      queried_at: QUERIED_AT,
    });
    expect(result.provenance).toEqual({
      deployment_or_view_id: REGISTRY_HASH,
      schema_version: null,
      methodology_version: null,
      query_id: NUTHATCH_FRESHNESS_QUERY_ID,
    });
    expect(result.warnings).toEqual([]);
  });

  it("lowercases a mixed-case pool address and hashes from the row", async () => {
    const mixedRow = {
      ...ROW,
      pool_address: "0x6C561B446416E1A00E8E93E221854D6EA4171372",
      last_swap_block_hash: "0xC2FD40C2F6B9A9B1E59737D6053354885B3336AC801A3F7C0340902420EC9DC2",
    };
    const result = await run({
      sql: { ok: true, status: 200, body: { rows: [mixedRow] }, latencyMs: 1 },
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.pool_address).toBe(POOL);
      expect(result.data.last_swap_block_hash).toBe(BLOCK_HASH);
    }
  });

  it("passes the fixed SQL and max_rows=1 to /sql", async () => {
    const calls: Array<{ query: string; maxRows: number }> = [];
    const client: NuthatchClient = {
      ...scriptClient({}),
      sql: (query, maxRows) => {
        calls.push({ query, maxRows });
        return Promise.resolve(SQL_OK);
      },
    };
    await fetchNuthatchFreshness({ client, clock: () => QUERIED_AT, record: RECORD });
    expect(calls).toEqual([{ query: NUTHATCH_FRESHNESS_QUERY, maxRows: 1 }]);
  });

  it("uses the injected clock for queried_at", async () => {
    const result = await run({});
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.freshness.queried_at).toBe(QUERIED_AT);
    }
  });
});

describe("fetchNuthatchFreshness — /ready 503 stale path", () => {
  const READY_503: NuthatchHttpResult = {
    ok: false,
    status: 503,
    error: { kind: "http", message: "/ready returned HTTP 503." },
    latencyMs: 1,
  };

  it("returns stale with retained freshness when /sql still answers a valid row", async () => {
    const result = await run({ ready: READY_503 });
    expect(result.status).toBe("stale");
    expect(result.data).toBeNull();
    expect(result.freshness).toEqual({
      indexed_block: 48756852,
      indexed_block_timestamp: 1784303051,
      indexed_block_hash: BLOCK_HASH,
      queried_at: QUERIED_AT,
    });
    // /nest and /schema are not consulted on the stale path; provenance falls
    // back to the registry-pinned values.
    expect(result.provenance.deployment_or_view_id).toBe(REGISTRY_HASH);
  });

  it("returns stale with null freshness when /sql fails on transport", async () => {
    const result = await run({ ready: READY_503, sql: err("transport") });
    expect(result.status).toBe("stale");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
  });

  it("returns stale with null freshness when /sql times out", async () => {
    const result = await run({ ready: READY_503, sql: err("timeout") });
    expect(result.status).toBe("stale");
    expect(result.freshness).toBeNull();
  });

  it("returns stale with null freshness when /sql returns zero rows", async () => {
    const result = await run({
      ready: READY_503,
      sql: { ok: true, status: 200, body: { rows: [] }, latencyMs: 1 },
    });
    expect(result.status).toBe("stale");
    expect(result.freshness).toBeNull();
  });
});

describe("fetchNuthatchFreshness — readiness failures", () => {
  it("maps /ready timeout to timeout with null freshness", async () => {
    const result = await run({ ready: err("timeout") });
    expect(result.status).toBe("timeout");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
  });

  it("maps /ready transport failure to error", async () => {
    const result = await run({ ready: err("transport") });
    expect(result.status).toBe("error");
  });

  it("maps an unexpected /ready HTTP 500 to error", async () => {
    const result = await run({ ready: err("http", 500) });
    expect(result.status).toBe("error");
  });

  it("maps /ready invalid_json to error", async () => {
    const result = await run({ ready: err("invalid_json") });
    expect(result.status).toBe("error");
  });

  it("maps /ready oversize to error", async () => {
    const result = await run({ ready: err("oversize") });
    expect(result.status).toBe("error");
  });

  it("does not call /nest, /schema, or /sql when /ready fails non-503", async () => {
    const calls: string[] = [];
    const client: NuthatchClient = {
      health: () => Promise.resolve(READY_OK),
      ready: () => (calls.push("ready"), Promise.resolve(err("transport"))),
      nest: () => (calls.push("nest"), Promise.resolve(NEST_OK)),
      schema: () => (calls.push("schema"), Promise.resolve(SCHEMA_OK)),
      explain: () => Promise.resolve(SCHEMA_OK),
      sql: () => (calls.push("sql"), Promise.resolve(SQL_OK)),
    };
    const result = await fetchNuthatchFreshness({
      client,
      clock: () => QUERIED_AT,
      record: RECORD,
    });
    expect(result.status).toBe("error");
    expect(calls).toEqual(["ready"]);
  });
});
