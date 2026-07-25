import { describe, expect, it } from "vitest";

import { fetchNuthatchFreshness } from "./adapter.js";
import {
  BLOCK_HASH,
  err,
  OTHER_HASH,
  QUERIED_AT,
  RECORD,
  REGISTRY_HASH,
  ROW,
  run,
  scriptClient,
} from "./adapter-fixtures.js";
import type { NuthatchClient } from "./client.js";

describe("fetchNuthatchFreshness — /nest drift", () => {
  it("maps registry_hash mismatch to unsupported and records the observed hash in provenance", async () => {
    const result = await run({
      nest: {
        ok: true,
        status: 200,
        body: { registry_hash: OTHER_HASH, name: "other", table_count: 9 },
        latencyMs: 2,
      },
    });
    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.provenance.deployment_or_view_id).toBe(OTHER_HASH);
    const warning = result.warnings.join(" ");
    expect(warning).toContain(REGISTRY_HASH);
    expect(warning).toContain(OTHER_HASH);
  });

  it("maps a missing registry_hash to unsupported", async () => {
    const result = await run({
      nest: { ok: true, status: 200, body: { name: "x" }, latencyMs: 2 },
    });
    expect(result.status).toBe("unsupported");
    expect(result.freshness).not.toBeNull();
  });

  it("maps a malformed registry_hash to unsupported", async () => {
    const result = await run({
      nest: { ok: true, status: 200, body: { registry_hash: "0xshort" }, latencyMs: 2 },
    });
    expect(result.status).toBe("unsupported");
  });

  it("maps /nest transport failure to error while retaining freshness", async () => {
    const result = await run({ nest: err("transport") });
    expect(result.status).toBe("error");
    expect(result.freshness).not.toBeNull();
  });

  it("maps /nest timeout to timeout while retaining freshness", async () => {
    const result = await run({ nest: err("timeout") });
    expect(result.status).toBe("timeout");
    expect(result.freshness).not.toBeNull();
  });
});

describe("fetchNuthatchFreshness — /schema drift", () => {
  it("maps a non-string schema body to unsupported", async () => {
    const result = await run({
      schema: { ok: true, status: 200, body: { tables: [] }, latencyMs: 2 },
    });
    expect(result.status).toBe("unsupported");
    expect(result.freshness).not.toBeNull();
  });

  it("maps an empty schema body to unsupported", async () => {
    const result = await run({ schema: { ok: true, status: 200, body: "   ", latencyMs: 2 } });
    expect(result.status).toBe("unsupported");
  });

  it("maps /schema transport failure to error", async () => {
    const result = await run({ schema: err("transport") });
    expect(result.status).toBe("error");
  });

  it("maps /schema timeout to timeout", async () => {
    const result = await run({ schema: err("timeout") });
    expect(result.status).toBe("timeout");
  });
});

describe("fetchNuthatchFreshness — /sql row drift", () => {
  it("maps zero rows to unsupported with null freshness", async () => {
    const result = await run({ sql: { ok: true, status: 200, body: { rows: [] }, latencyMs: 1 } });
    expect(result.status).toBe("unsupported");
    expect(result.freshness).toBeNull();
  });

  it("maps more than one row to unsupported", async () => {
    const result = await run({
      sql: { ok: true, status: 200, body: { rows: [ROW, ROW] }, latencyMs: 1 },
    });
    expect(result.status).toBe("unsupported");
  });

  it("maps a malformed pool_address to unsupported", async () => {
    const result = await run({
      sql: {
        ok: true,
        status: 200,
        body: { rows: [{ ...ROW, pool_address: "0xdeadbeef" }] },
        latencyMs: 1,
      },
    });
    expect(result.status).toBe("unsupported");
  });

  it("maps a malformed block hash to unsupported", async () => {
    const result = await run({
      sql: {
        ok: true,
        status: 200,
        body: { rows: [{ ...ROW, last_swap_block_hash: "0xshort" }] },
        latencyMs: 1,
      },
    });
    expect(result.status).toBe("unsupported");
  });

  it("maps a numeric-string count to unsupported", async () => {
    const result = await run({
      sql: {
        ok: true,
        status: 200,
        body: { rows: [{ ...ROW, recent_swap_count_24h: "42" }] },
        latencyMs: 1,
      },
    });
    expect(result.status).toBe("unsupported");
  });

  it("maps /sql transport failure to error with null freshness", async () => {
    const result = await run({ sql: err("transport") });
    expect(result.status).toBe("error");
    expect(result.freshness).toBeNull();
  });

  it("maps /sql timeout to timeout with null freshness", async () => {
    const result = await run({ sql: err("timeout") });
    expect(result.status).toBe("timeout");
    expect(result.freshness).toBeNull();
  });

  it("maps /sql invalid_json to error", async () => {
    const result = await run({ sql: err("invalid_json") });
    expect(result.status).toBe("error");
  });

  it("maps /sql oversize to error", async () => {
    const result = await run({ sql: err("oversize") });
    expect(result.status).toBe("error");
  });

  it("maps an unexpected /sql HTTP 400 to error", async () => {
    const result = await run({ sql: err("http", 400) });
    expect(result.status).toBe("error");
  });
});

describe("fetchNuthatchFreshness — status precedence", () => {
  it("timeout takes precedence over unsupported when both occur", async () => {
    const result = await run({
      nest: err("timeout"),
      sql: { ok: true, status: 200, body: { rows: [] }, latencyMs: 1 },
    });
    expect(result.status).toBe("timeout");
  });

  it("unsupported takes precedence over error when both occur", async () => {
    const result = await run({
      nest: { ok: true, status: 200, body: { registry_hash: OTHER_HASH }, latencyMs: 1 },
      schema: err("transport"),
    });
    expect(result.status).toBe("unsupported");
  });

  it("retains freshness from a valid /sql row on a non-ok aggregate status", async () => {
    const result = await run({ schema: err("transport") });
    expect(result.status).toBe("error");
    expect(result.freshness).toEqual({
      indexed_block: 48756852,
      indexed_block_timestamp: 1784303051,
      indexed_block_hash: BLOCK_HASH,
      queried_at: QUERIED_AT,
    });
  });
});

describe("fetchNuthatchFreshness — registry record validation", () => {
  it("rejects a record bound to the wrong view without calling the client", async () => {
    let calls = 0;
    const client: NuthatchClient = {
      ...scriptClient({}),
      health: () => (calls++, Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 })),
      ready: () => (
        calls++,
        Promise.resolve({ ok: true, status: 200, body: { ready: true }, latencyMs: 0 })
      ),
      nest: () => (calls++, Promise.resolve({ ok: true, status: 200, body: {}, latencyMs: 0 })),
      schema: () => (calls++, Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 })),
      explain: () => (calls++, Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 })),
      sql: () => (
        calls++,
        Promise.resolve({ ok: true, status: 200, body: { rows: [] }, latencyMs: 0 })
      ),
    };
    const result = await fetchNuthatchFreshness({
      client,
      clock: () => QUERIED_AT,
      record: { ...RECORD, locator: { ...RECORD.locator, view_id: "other_view" } },
    });
    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
    expect(calls).toBe(0);
  });

  it("rejects an inactive record", async () => {
    const result = await fetchNuthatchFreshness({
      client: scriptClient({}),
      clock: () => QUERIED_AT,
      record: { ...RECORD, status: "inactive" },
    });
    expect(result.status).toBe("unsupported");
  });
});

describe("fetchNuthatchFreshness — boundary safety", () => {
  it("never lets a client throw escape the adapter boundary", async () => {
    const client: NuthatchClient = {
      health: () => Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 }),
      ready: () => {
        throw new Error("boom");
      },
      nest: () => Promise.resolve({ ok: true, status: 200, body: {}, latencyMs: 0 }),
      schema: () => Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 }),
      explain: () => Promise.resolve({ ok: true, status: 200, body: "", latencyMs: 0 }),
      sql: () => Promise.resolve({ ok: true, status: 200, body: { rows: [] }, latencyMs: 0 }),
    };
    const result = await fetchNuthatchFreshness({
      client,
      clock: () => QUERIED_AT,
      record: RECORD,
    });
    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings.join(" ")).not.toContain("boom");
  });

  it("redacts base URL, admin tokens, and SQL from warnings through the real client", async () => {
    const { createNuthatchClient } = await import("./client.js");
    const secretFetch = (() =>
      Promise.reject(
        new Error(
          "https://wallet-intel.example.ts.net admin-token-leak SELECT * FROM pool_swap_freshness",
        ),
      )) as unknown as typeof fetch;
    const client = createNuthatchClient({
      baseUrl: "https://wallet-intel.example.ts.net",
      fetchImpl: secretFetch,
      timeoutMs: 5_000,
    });
    const result = await fetchNuthatchFreshness({
      client,
      clock: () => QUERIED_AT,
      record: RECORD,
    });
    expect(result.status).toBe("error");
    const warnings = result.warnings.join(" ");
    expect(warnings).not.toContain("https://");
    expect(warnings).not.toContain("admin-token");
    expect(warnings).not.toContain("SELECT");
    expect(warnings).not.toContain("wallet-intel");
  });
});
