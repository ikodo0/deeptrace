import { describe, expect, it } from "vitest";

import {
  NormalizationError,
  bindComparePoolsGraphResult,
  bindComparePoolsGraphResults,
  convertPoolSourceResult,
  toPoolComparisonRecord,
} from "../../src/normalization/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import { livePartialComparePoolsFixture } from "../fixtures/live-compare-pools.js";
import { graphPoolA, graphPoolB, graphPoolCTimeout } from "../fixtures/sources/index.js";

describe("bindComparePoolsGraphResult", () => {
  it("normalizes live Graph fixtures identically to the pure converter", () => {
    expect(bindComparePoolsGraphResult(graphPoolA, "24h")).toEqual(
      convertPoolSourceResult(graphPoolA, "24h"),
    );
    expect(bindComparePoolsGraphResult(graphPoolB, "24h")).toEqual(
      convertPoolSourceResult(graphPoolB, "24h"),
    );
    expect(bindComparePoolsGraphResult(graphPoolA, "7d")).toEqual(
      convertPoolSourceResult(graphPoolA, "7d"),
    );
  });

  it("returns null for in-scope non-ok Graph results", () => {
    expect(bindComparePoolsGraphResult(graphPoolCTimeout, "24h")).toBeNull();
  });

  it("binds both live Graph sources and skips timeouts", () => {
    const candidates = bindComparePoolsGraphResults(
      [graphPoolCTimeout, graphPoolA, graphPoolB],
      "24h",
    );
    expect(candidates.map((candidate) => candidate.source_ids[0])).toEqual([
      "uniswap-v3-base-native",
      "exchange-v3-base",
    ]);
    expect(candidates[0]?.pool_address).toBe(M0_COMPARE_POOLS_SCOPE.graphSources[0].pool_address);
    expect(candidates[1]?.pool_address).toBe(M0_COMPARE_POOLS_SCOPE.graphSources[1].pool_address);
  });

  it("matches live compare_pools fixture pool identities after explicit ranking", () => {
    const candidates = bindComparePoolsGraphResults([graphPoolA, graphPoolB], "24h");
    const ranked = [
      toPoolComparisonRecord(candidates[1]!, 1),
      toPoolComparisonRecord(candidates[0]!, 2),
    ];

    expect(ranked.map((pool) => pool.pool_address)).toEqual(
      livePartialComparePoolsFixture.data.pools.map((pool) => pool.pool_address),
    );
    expect(ranked.map((pool) => pool.source_ids)).toEqual(
      livePartialComparePoolsFixture.data.pools.map((pool) => [...pool.source_ids]),
    );
    expect(ranked.map((pool) => pool.volume_usd)).toEqual(
      livePartialComparePoolsFixture.data.pools.map((pool) => pool.volume_usd),
    );
  });

  it("rejects unknown Graph source IDs before conversion", () => {
    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          source_id: "invented-dex",
        },
        "24h",
      ),
    ).toThrow(/not in the locked compare_pools Graph allowlist/);
  });

  it("rejects Nuthatch results as Graph pool candidates", () => {
    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          source_id: M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
        },
        "24h",
      ),
    ).toThrow(/Nuthatch results are not Graph pool candidates/);
  });

  it("rejects mismatched deployment, pool, protocol, and pair before metrics", () => {
    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          provenance: {
            ...graphPoolA.provenance,
            query_id: "other-query-v1",
          },
        },
        "24h",
      ),
    ).toThrow(/query_id does not match/);

    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          data: {
            ...graphPoolA.data,
            token0: {
              ...graphPoolA.data.token0,
              symbol: "WETHX",
            },
          },
        },
        "24h",
      ),
    ).toThrow(/token metadata does not match/);

    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          provenance: {
            ...graphPoolA.provenance,
            deployment_or_view_id: "QmWrongDeploymentHashxxxxxxxxxxxxxxxxxxxxxxxxx",
          },
        },
        "24h",
      ),
    ).toThrow(/deployment does not match/);

    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          data: {
            ...graphPoolA.data,
            pool_address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
          },
        },
        "24h",
      ),
    ).toThrow(/pool address does not match/);

    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          protocol: "sushiswap-v3",
        },
        "24h",
      ),
    ).toThrow(/protocol does not match/);

    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          data: {
            ...graphPoolA.data,
            token1: {
              address: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
              symbol: "USDbC",
              decimals: 6,
            },
          },
        },
        "24h",
      ),
    ).toThrow(/outside the locked compare_pools pair/);
  });

  it("rejects wrong chain_id before conversion", () => {
    expect(() =>
      bindComparePoolsGraphResult(
        {
          ...graphPoolA,
          chain_id: 1 as never,
        },
        "24h",
      ),
    ).toThrow(NormalizationError);
  });
});
