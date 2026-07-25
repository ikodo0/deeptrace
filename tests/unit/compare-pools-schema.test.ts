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
        coverage: {
          ...completeComparePoolsFixture.coverage,
          nuthatch_available: false,
        },
      }).success,
    ).toBe(false);
    expect(
      comparePoolsResponseSchema.safeParse({
        ...completeComparePoolsFixture,
        freshness: completeComparePoolsFixture.freshness.map((entry, index) =>
          index === 0 ? { ...entry, status: "stale" } : entry,
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
        provenance: completeComparePoolsFixture.provenance.map((entry, index) =>
          index === 3 ? { ...entry, source_type: "native_subgraph" } : entry,
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
