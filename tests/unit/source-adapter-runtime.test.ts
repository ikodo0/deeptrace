import { describe, expect, it } from "vitest";

import {
  nuthatchFreshnessDataSchema,
  nuthatchSourceResultSchema,
  poolSourceDataSchema,
  poolSourceResultSchema,
} from "../../src/schemas/source-adapter.js";
import {
  graphPoolA,
  graphPoolB,
  graphPoolC,
  graphPoolCTimeout,
  nuthatchFreshness,
} from "../fixtures/sources/index.js";

describe("source adapter runtime validation", () => {
  it("accepts all canonical source fixtures unchanged", () => {
    expect(poolSourceResultSchema.parse(graphPoolA)).toEqual(graphPoolA);
    expect(poolSourceResultSchema.parse(graphPoolB)).toEqual(graphPoolB);
    expect(poolSourceResultSchema.parse(graphPoolC)).toEqual(graphPoolC);
    expect(poolSourceResultSchema.parse(graphPoolCTimeout)).toEqual(graphPoolCTimeout);
    expect(nuthatchSourceResultSchema.parse(nuthatchFreshness)).toEqual(nuthatchFreshness);
  });

  it("rejects unknown fields at every object boundary", () => {
    const candidates = [
      { ...graphPoolA, unexpected: true },
      { ...graphPoolA, data: { ...graphPoolA.data, unexpected: true } },
      {
        ...graphPoolA,
        data: {
          ...graphPoolA.data,
          token0: { ...graphPoolA.data.token0, unexpected: true },
        },
      },
      { ...graphPoolA, freshness: { ...graphPoolA.freshness, unexpected: true } },
      { ...graphPoolA, provenance: { ...graphPoolA.provenance, unexpected: true } },
    ];

    for (const candidate of candidates) {
      expect(poolSourceResultSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it.each([
    ["chain", { ...graphPoolA, chain_id: 1 }],
    [
      "address",
      {
        ...graphPoolA,
        data: { ...graphPoolA.data, pool_address: "0xnot-an-address" },
      },
    ],
    [
      "decimal",
      {
        ...graphPoolA,
        data: { ...graphPoolA.data, tvl_usd: "not-a-decimal" },
      },
    ],
    [
      "timestamp",
      {
        ...graphPoolA,
        freshness: { ...graphPoolA.freshness, indexed_block_timestamp: -1 },
      },
    ],
    ["status", { ...graphPoolA, status: "pending" }],
  ])("rejects an invalid %s", (_label, candidate) => {
    expect(poolSourceResultSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      "hash",
      {
        ...nuthatchFreshness,
        data: { ...nuthatchFreshness.data, last_swap_block_hash: "0xdeadbeef" },
      },
    ],
    [
      "count",
      {
        ...nuthatchFreshness,
        data: { ...nuthatchFreshness.data, recent_swap_count_24h: -1 },
      },
    ],
  ])("rejects an invalid Nuthatch %s", (_label, candidate) => {
    expect(nuthatchSourceResultSchema.safeParse(candidate).success).toBe(false);
  });

  it("requires successful results to contain both data and freshness", () => {
    expect(poolSourceResultSchema.safeParse({ ...graphPoolA, data: null }).success).toBe(false);
    expect(poolSourceResultSchema.safeParse({ ...graphPoolA, freshness: null }).success).toBe(
      false,
    );
  });

  it("requires Nuthatch results with freshness to include the indexed block hash", () => {
    const freshnessWithoutHash: Record<string, unknown> = {
      ...nuthatchFreshness.freshness,
    };
    delete freshnessWithoutHash.indexed_block_hash;

    expect(
      nuthatchSourceResultSchema.safeParse({
        ...nuthatchFreshness,
        freshness: freshnessWithoutHash,
      }).success,
    ).toBe(false);
  });

  it("requires non-ok results to contain null data", () => {
    const candidate = {
      ...graphPoolCTimeout,
      data: graphPoolC.data,
    };

    expect(poolSourceResultSchema.safeParse(candidate).success).toBe(false);
  });

  it('preserves measured "0" separately from unavailable null', () => {
    const measuredZero = poolSourceResultSchema.parse({
      ...graphPoolA,
      data: { ...graphPoolA.data, tvl_usd: "0" },
    });
    const unavailable = poolSourceResultSchema.parse({
      ...graphPoolA,
      data: { ...graphPoolA.data, tvl_usd: null },
    });

    expect(measuredZero.data?.tvl_usd).toBe("0");
    expect(unavailable.data?.tvl_usd).toBeNull();
    expect(measuredZero.data?.tvl_usd).not.toBe(unavailable.data?.tvl_usd);
  });

  it("accepts fractional non-negative source latency", () => {
    const candidate = {
      ...graphPoolA,
      latency_ms: 101.25,
    };

    expect(poolSourceResultSchema.parse(candidate).latency_ms).toBe(101.25);
  });

  it("rejects pool and Nuthatch payloads and results at the opposite boundary", () => {
    expect(poolSourceDataSchema.safeParse(nuthatchFreshness.data).success).toBe(false);
    expect(nuthatchFreshnessDataSchema.safeParse(graphPoolA.data).success).toBe(false);
    expect(poolSourceResultSchema.safeParse(nuthatchFreshness).success).toBe(false);
    expect(nuthatchSourceResultSchema.safeParse(graphPoolA).success).toBe(false);
  });
});
