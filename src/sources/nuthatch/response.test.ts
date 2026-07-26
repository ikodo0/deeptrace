import { describe, expect, it } from "vitest";

import { parseFreshnessRows, parseNest, parseSchema } from "./response.js";

const VALID_ROW = {
  pool_address: "0x6C561b446416e1A00e8E93e221854d6eA4171372",
  recent_swap_count_24h: 42,
  last_swap_block: 48756852,
  last_swap_block_timestamp: 1784303051,
  last_swap_block_hash: "0xC2FD40c2f6b9a9b1e59737d6053354885b3336ac801a3f7c0340902420ec9dc2",
  last_swap_tx_hash: "0x5A02a9e244c5191381b04066377bd9b06cec47b962074200dc0d9a4702357733",
  last_swap_log_index: 21,
} as const;

function envelope(row: unknown): unknown {
  const rows = Array.isArray(row) ? row : [row];
  return { count: rows.length, provenance: {}, rows, truncated: false };
}

describe("parseFreshnessRows", () => {
  it("normalizes valid hex fields to lowercase and returns the row", () => {
    const result = parseFreshnessRows(envelope(VALID_ROW));
    expect(result).toEqual({
      ok: true,
      row: {
        pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
        recent_swap_count_24h: 42,
        last_swap_block: 48756852,
        last_swap_block_timestamp: 1784303051,
        last_swap_block_hash: "0xc2fd40c2f6b9a9b1e59737d6053354885b3336ac801a3f7c0340902420ec9dc2",
        last_swap_tx_hash: "0x5a02a9e244c5191381b04066377bd9b06cec47b962074200dc0d9a4702357733",
        last_swap_log_index: 21,
      },
    });
  });

  it("rejects zero rows as empty (not shape)", () => {
    const result = parseFreshnessRows(envelope([]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("empty");
    }
  });

  it("rejects more than one row as multi (not shape)", () => {
    const result = parseFreshnessRows(envelope([VALID_ROW, VALID_ROW]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("multi");
    }
  });

  it("rejects a body that is not an object as shape drift", () => {
    expect(parseFreshnessRows(null).ok).toBe(false);
    expect(parseFreshnessRows("rows").ok).toBe(false);
    expect(parseFreshnessRows(7).ok).toBe(false);
  });

  it("rejects an envelope whose rows field is missing or wrong type", () => {
    const missing = parseFreshnessRows({ count: 0 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failure.kind).toBe("shape");
    }
    expect(parseFreshnessRows({ rows: "not-an-array" }).ok).toBe(false);
  });

  it.each([
    ["pool_address", { ...VALID_ROW, pool_address: "0xdeadbeef" }],
    [
      "pool_address non-hex",
      { ...VALID_ROW, pool_address: "0xZZ561b446416e1a00e8e93e221854d6ea4171372" },
    ],
    ["last_swap_block_hash", { ...VALID_ROW, last_swap_block_hash: "0xshort" }],
    ["last_swap_tx_hash", { ...VALID_ROW, last_swap_tx_hash: "0xshort" }],
    ["recent_swap_count as string", { ...VALID_ROW, recent_swap_count_24h: "42" }],
    ["last_swap_block negative", { ...VALID_ROW, last_swap_block: -1 }],
    ["last_swap_block_timestamp float", { ...VALID_ROW, last_swap_block_timestamp: 1.5 }],
    [
      "last_swap_log_index unsafe",
      { ...VALID_ROW, last_swap_log_index: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["row not an object", "not-an-object"],
  ])("classifies %s as shape drift", (_label, row) => {
    const result = parseFreshnessRows(envelope(row));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("shape");
    }
  });

  it("rejects numeric strings where the contract requires a number", () => {
    const result = parseFreshnessRows(envelope({ ...VALID_ROW, last_swap_block: "48756852" }));
    expect(result.ok).toBe(false);
  });

  it("rejects null rows and missing columns", () => {
    expect(parseFreshnessRows(envelope(null)).ok).toBe(false);
    const missingColumn = { ...VALID_ROW } as Record<string, unknown>;
    delete missingColumn.last_swap_tx_hash;
    expect(parseFreshnessRows(envelope(missingColumn)).ok).toBe(false);
  });

  it("does not silently coerce extra columns into the row", () => {
    const result = parseFreshnessRows(envelope({ ...VALID_ROW, extra: true }));
    // Extra columns are tolerated at the row level; the contract is enforced
    // by the zod schema on the final SourceResult, not the parser. This test
    // pins current behavior so a future tightening is intentional.
    expect(result.ok).toBe(true);
  });
});

describe("parseNest", () => {
  const VALID_NEST = {
    chain: "base",
    chain_id: 8453,
    contracts: [{ address: "0x6c561b446416e1a00e8e93e221854d6ea4171372", alias: "pool" }],
    factories: [],
    name: "deeptrace-pool-freshness",
    registry_hash: "0x46E57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25",
    table_count: 9,
    templates: [],
    webhooks: [],
  } as const;

  it("extracts and lowercases the registry hash", () => {
    const result = parseNest(VALID_NEST);
    expect(result).toEqual({
      ok: true,
      registryHash: "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25",
      nestName: "deeptrace-pool-freshness",
      tableCount: 9,
    });
  });

  it("rejects a missing or malformed registry_hash as shape drift", () => {
    expect(parseNest({ ...VALID_NEST, registry_hash: undefined }).ok).toBe(false);
    expect(parseNest({ ...VALID_NEST, registry_hash: "0xshort" }).ok).toBe(false);
    expect(parseNest({}).ok).toBe(false);
    expect(parseNest(null).ok).toBe(false);
  });

  it("tolerates missing name and table_count but still requires registry_hash", () => {
    const minimal = { registry_hash: VALID_NEST.registry_hash };
    const result = parseNest(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nestName).toBeNull();
      expect(result.tableCount).toBeNull();
    }
  });
});

describe("parseSchema", () => {
  it("accepts a non-empty schema document and reports schema_version null for 0.6.1", () => {
    const result = parseSchema("nuthatch data model\n\nTABLES...");
    expect(result).toEqual({
      ok: true,
      schemaText: "nuthatch data model\n\nTABLES...",
      schemaVersion: null,
    });
  });

  it("rejects non-string bodies as shape drift", () => {
    expect(parseSchema(null).ok).toBe(false);
    expect(parseSchema({ tables: [] }).ok).toBe(false);
    expect(parseSchema(42).ok).toBe(false);
  });

  it("rejects an empty schema body as shape drift", () => {
    expect(parseSchema("").ok).toBe(false);
    expect(parseSchema("   \n  ").ok).toBe(false);
  });
});
