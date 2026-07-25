import { describe, expect, it } from "vitest";

import { comparePoolsResponseSchema, poolComparisonRecordSchema } from "../../src/schemas/index.js";
import {
  comparePoolsFixtures,
  completeComparePoolsFixture,
  failedComparePoolsFixture,
  partialComparePoolsFixture,
} from "../fixtures/compare-pools.js";

describe("compare_pools response schemas", () => {
  it("accepts complete, partial, and failed fixtures", () => {
    for (const fixture of comparePoolsFixtures) {
      expect(comparePoolsResponseSchema.parse(fixture)).toEqual(fixture);
    }
  });

  it("preserves measured zero and unavailable financial values", () => {
    expect(completeComparePoolsFixture.data.pools[1].fees_usd).toBe("0");
    expect(partialComparePoolsFixture.data.pools[1].volume_usd).toBeNull();
    expect(comparePoolsResponseSchema.parse(completeComparePoolsFixture)).toEqual(
      completeComparePoolsFixture,
    );
    expect(comparePoolsResponseSchema.parse(partialComparePoolsFixture)).toEqual(
      partialComparePoolsFixture,
    );
  });

  it("rejects unknown public response and record fields", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        raw_graph_response: {},
      }).success,
    ).toBe(false);
    expect(
      poolComparisonRecordSchema.safeParse({
        ...completeComparePoolsFixture.data.pools[0],
        token0: {},
      }).success,
    ).toBe(false);
  });

  it("rejects JavaScript numbers and malformed decimal strings for financial values", () => {
    for (const volumeUsd of [1.25, "-1", "01", "1e3"]) {
      expect(
        poolComparisonRecordSchema.safeParse({
          ...completeComparePoolsFixture.data.pools[0],
          volume_usd: volumeUsd,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects failed responses that report successful deployments", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...failedComparePoolsFixture,
        coverage: {
          ...failedComparePoolsFixture.coverage,
          successful_deployments: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a successful deployment count that differs from pool records", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        coverage: {
          ...partialComparePoolsFixture.coverage,
          successful_deployments: 1,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects complete responses with degraded coverage", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          nuthatch_freshness_fact: null,
        },
        coverage: {
          ...completeComparePoolsFixture.coverage,
          nuthatch_available: false,
        },
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 3 ? { source_id: entry.source_id, status: "unavailable" } : entry,
        ),
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                status: "stale",
                indexed_block_timestamp: entry.queried_at - 301,
                lag_seconds: 301,
              }
            : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects partial responses without degraded coverage", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        status: "partial",
      }).success,
    ).toBe(false);
  });

  it("requires one freshness entry for every attempted source", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.slice(1),
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 0 ? { ...entry, source_id: "fixture-unknown" } : entry,
        ),
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        provenance: completeComparePoolsFixture.provenance.map((entry, index) =>
          index === 3 ? { ...entry, source_type: "native_subgraph" } : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires observed Nuthatch freshness to include a block hash", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 3 ? { ...entry, indexed_block_hash: null } : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("enforces the freshness threshold and lag calculation", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 0 ? { ...entry, lag_seconds: 301 } : entry,
        ),
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        freshness: partialComparePoolsFixture.freshness.map((entry, index) =>
          index === 1 ? { ...entry, status: "fresh" } : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires pool records to match response pair, window, and rank order", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          pools: completeComparePoolsFixture.data.pools.map((pool, index) =>
            index === 0 ? { ...pool, rank: 2 } : pool,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          pools: completeComparePoolsFixture.data.pools.map((pool, index) =>
            index === 0
              ? {
                  ...pool,
                  pair: [{ ...pool.pair[0], decimals: 6 }, pool.pair[1]],
                }
              : pool,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          pools: completeComparePoolsFixture.data.pools.map((pool, index) =>
            index === 0 ? { ...pool, window: "7d" } : pool,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects source references absent from provenance", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        ai_reasoning: {
          ...completeComparePoolsFixture.ai_reasoning,
          source_ids: ["invented-source"],
        },
      }).success,
    ).toBe(false);
  });

  it("requires the Nuthatch fact to reference Nuthatch provenance", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          nuthatch_freshness_fact: {
            ...completeComparePoolsFixture.data.nuthatch_freshness_fact,
            source_id: "fixture-dex-a",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires Nuthatch coverage to match fact availability", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        coverage: {
          ...completeComparePoolsFixture.coverage,
          nuthatch_available: false,
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        coverage: {
          ...partialComparePoolsFixture.coverage,
          nuthatch_available: true,
        },
      }).success,
    ).toBe(false);
  });

  it("requires facts and financial records to reference observed sources", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        data: {
          ...partialComparePoolsFixture.data,
          pools: [
            partialComparePoolsFixture.data.pools[0],
            {
              ...partialComparePoolsFixture.data.pools[1],
              source_ids: ["fixture-dex-c"],
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        status: "partial",
        warnings: ["fixture-nuthatch was unavailable"],
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 3 ? { source_id: entry.source_id, status: "unavailable" } : entry,
        ),
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        freshness: partialComparePoolsFixture.freshness.map((entry, index) =>
          index === 3
            ? {
                source_id: entry.source_id,
                status: "fresh",
                indexed_block: 12_345_678,
                indexed_block_timestamp: 1_699_999_992,
                indexed_block_hash: `0x${"2".repeat(64)}`,
                queried_at: 1_700_000_000,
                lag_seconds: 8,
              }
            : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires failed Nuthatch coverage to match observed freshness", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...failedComparePoolsFixture,
        coverage: {
          ...failedComparePoolsFixture.coverage,
          nuthatch_available: true,
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...failedComparePoolsFixture,
        freshness: failedComparePoolsFixture.freshness.map((entry, index) =>
          index === 3
            ? {
                source_id: entry.source_id,
                status: "fresh",
                indexed_block: 12_345_678,
                indexed_block_timestamp: 1_699_999_992,
                indexed_block_hash: `0x${"3".repeat(64)}`,
                queried_at: 1_700_000_000,
                lag_seconds: 8,
              }
            : entry,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects Nuthatch provenance for pool financial records", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        data: {
          ...completeComparePoolsFixture.data,
          pools: completeComparePoolsFixture.data.pools.map((pool, index) =>
            index === 0 ? { ...pool, source_ids: ["fixture-nuthatch"] } : pool,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it("requires degraded partial responses to include warnings", () => {
    expect(
      comparePoolsResponseSchema.safeParse({
        ...partialComparePoolsFixture,
        warnings: [],
      }).success,
    ).toBe(false);
  });

  it("rejects uppercase public addresses", () => {
    expect(
      poolComparisonRecordSchema.safeParse({
        ...completeComparePoolsFixture.data.pools[0],
        pool_address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate source IDs and identical pair tokens", () => {
    expect(
      poolComparisonRecordSchema.safeParse({
        ...completeComparePoolsFixture.data.pools[0],
        source_ids: ["fixture-dex-a", "fixture-dex-a"],
      }).success,
    ).toBe(false);
    expect(
      poolComparisonRecordSchema.safeParse({
        ...completeComparePoolsFixture.data.pools[0],
        pair: [completeComparePoolsFixture.data.pair[0], completeComparePoolsFixture.data.pair[0]],
      }).success,
    ).toBe(false);
  });
});
