import { describe, expect, it } from "vitest";

import { rankCanonicalPools } from "../../src/metrics/index.js";
import { bindComparePoolsGraphResults } from "../../src/normalization/index.js";
import { QualityError, settleComparePoolsResult } from "../../src/quality/index.js";
import { comparePoolsResponseSchema } from "../../src/schemas/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import { graphPoolA, graphPoolB, graphPoolCTimeout } from "../fixtures/sources/index.js";

const livePair = [
  {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    address: M0_COMPARE_POOLS_SCOPE.token0.address,
    symbol: M0_COMPARE_POOLS_SCOPE.token0.symbol,
    decimals: M0_COMPARE_POOLS_SCOPE.token0.decimals,
  },
  {
    chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
    address: M0_COMPARE_POOLS_SCOPE.token1.address,
    symbol: M0_COMPARE_POOLS_SCOPE.token1.symbol,
    decimals: M0_COMPARE_POOLS_SCOPE.token1.decimals,
  },
] as const;

describe("settleComparePoolsResult", () => {
  it("returns partial when both Graph sources succeed but Nuthatch is unverified", () => {
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, graphPoolB], "24h"),
      {
        rankedBy: "volume_usd",
      },
    );
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [graphPoolB, graphPoolA],
      nuthatchResult: null,
    });

    expect(comparePoolsResponseSchema.parse(response).status).toBe("partial");
    expect(response.status).toBe("partial");
    expect(response.coverage).toEqual({
      requested_deployments: 2,
      successful_deployments: 2,
      nuthatch_available: false,
    });
    expect(response.data?.nuthatch_freshness_fact).toBeNull();
    expect(response.data?.pools).toHaveLength(2);
    expect(response.freshness.map((entry) => entry.source_id)).toEqual([
      "uniswap-v3-base-native",
      "exchange-v3-base",
      "nuthatch-pool-swaps",
    ]);
    expect(response.freshness[2]).toEqual({
      source_id: "nuthatch-pool-swaps",
      status: "unavailable",
    });
    expect(response.provenance[2]).toMatchObject({
      source_id: "nuthatch-pool-swaps",
      source_type: "nuthatch_view",
      protocol: "uniswap-v3",
      deployment_or_view_id: "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25",
      query_id: "nuthatch-pool-swap-freshness-v1",
    });
    expect(response.provenance[2]?.deployment_or_view_id).not.toBe("unverified-nuthatch-view");
    expect(response.warnings.some((warning) => warning.includes("nuthatch-pool-swaps"))).toBe(true);
  });

  it("preserves a successful Graph pool when the sibling times out", () => {
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, graphPoolCTimeout], "24h"),
      { rankedBy: "volume_usd" },
    );
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [graphPoolA, graphPoolCTimeout],
      nuthatchResult: null,
    });

    expect(response.status).toBe("partial");
    expect(response.coverage.successful_deployments).toBe(1);
    expect(response.data?.pools).toHaveLength(1);
    expect(response.data?.pools[0]?.source_ids).toEqual(["uniswap-v3-base-native"]);
    expect(response.freshness.find((entry) => entry.source_id === "exchange-v3-base")).toEqual({
      source_id: "exchange-v3-base",
      status: "unavailable",
    });
    expect(response.warnings.some((warning) => warning.includes("timed out"))).toBe(true);
    expect(comparePoolsResponseSchema.parse(response).status).toBe("partial");
  });

  it("maps non-ok Graph results with retained freshness to unavailable publicly", () => {
    const unsupportedPancake = {
      ...graphPoolB,
      status: "unsupported" as const,
      data: null,
      warnings: ["Graph response shape is unsupported."],
    };
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, unsupportedPancake], "24h"),
      { rankedBy: "volume_usd" },
    );
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [graphPoolA, unsupportedPancake],
      nuthatchResult: null,
    });

    expect(unsupportedPancake.freshness).not.toBeNull();
    expect(response.freshness.find((entry) => entry.source_id === "exchange-v3-base")).toEqual({
      source_id: "exchange-v3-base",
      status: "unavailable",
    });
    expect(response.status).toBe("partial");
    expect(comparePoolsResponseSchema.parse(response).status).toBe("partial");
  });

  it("returns failed when every Graph source is unavailable", () => {
    const timedOutUniswap = {
      ...graphPoolCTimeout,
      source_id: "uniswap-v3-base-native",
      protocol: "uniswap-v3",
      provenance: graphPoolA.provenance,
    };
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools: [],
      graphResults: [timedOutUniswap, graphPoolCTimeout],
      nuthatchResult: null,
    });

    expect(response.status).toBe("failed");
    expect(response.data).toBeNull();
    expect(response.coverage.successful_deployments).toBe(0);
    expect(response.coverage.nuthatch_available).toBe(false);
    expect(comparePoolsResponseSchema.parse(response).status).toBe("failed");
  });

  it("marks quality freshness stale from lag without rewriting adapter ok status", () => {
    const staleUniswap = {
      ...graphPoolA,
      freshness: {
        ...graphPoolA.freshness,
        indexed_block_timestamp: graphPoolA.freshness.queried_at - 301,
      },
    };
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([staleUniswap, graphPoolB], "24h"),
      { rankedBy: "volume_usd" },
    );
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [staleUniswap, graphPoolB],
      nuthatchResult: null,
    });

    expect(staleUniswap.status).toBe("ok");
    expect(response.freshness[0]).toMatchObject({
      source_id: "uniswap-v3-base-native",
      status: "stale",
      lag_seconds: 301,
    });
    expect(response.status).toBe("partial");
    expect(response.warnings.some((warning) => warning.includes("freshness threshold"))).toBe(true);
  });

  it("rejects Graph result sets that omit an allowlisted source", () => {
    expect(() =>
      settleComparePoolsResult({
        pair: livePair,
        window: "24h",
        rankedBy: "volume_usd",
        pools: [],
        graphResults: [graphPoolA, { ...graphPoolA, source_id: "invented-dex" }],
        nuthatchResult: null,
      }),
    ).toThrow(QualityError);
  });

  it("rejects successful Graph results without ranked pools", () => {
    expect(() =>
      settleComparePoolsResult({
        pair: livePair,
        window: "24h",
        rankedBy: "volume_usd",
        pools: [],
        graphResults: [graphPoolA, graphPoolB],
        nuthatchResult: null,
      }),
    ).toThrow(/require ranked pool records/);
  });

  it("keeps failed Graph settlement schema-valid when Nuthatch is ok", () => {
    const timedOutUniswap = {
      ...graphPoolCTimeout,
      source_id: "uniswap-v3-base-native",
      protocol: "uniswap-v3",
      provenance: graphPoolA.provenance,
    };
    const nuthatchOk = {
      source_id: "nuthatch-pool-swaps",
      source_type: "nuthatch_view" as const,
      protocol: "uniswap-v3",
      chain_id: 8453 as const,
      status: "ok" as const,
      data: {
        pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
        recent_swap_count_24h: 10,
        last_swap_block: 1,
        last_swap_block_timestamp: 1_700_000_000,
        last_swap_block_hash: `0x${"a".repeat(64)}`,
        last_swap_tx_hash: `0x${"b".repeat(64)}`,
        last_swap_log_index: 0,
      },
      freshness: {
        indexed_block: 1,
        indexed_block_timestamp: 1_700_000_000,
        indexed_block_hash: `0x${"a".repeat(64)}`,
        queried_at: 1_700_000_010,
      },
      provenance: {
        deployment_or_view_id: "live-nuthatch-view",
        schema_version: null,
        methodology_version: null,
        query_id: "nuthatch-pool-swap-freshness-v1",
      },
      warnings: [],
      latency_ms: 1,
    };

    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools: [],
      graphResults: [timedOutUniswap, graphPoolCTimeout],
      nuthatchResult: nuthatchOk,
    });

    expect(response.status).toBe("failed");
    expect(response.coverage.nuthatch_available).toBe(true);
    expect(response.freshness[2]?.status).toBe("fresh");
    expect(comparePoolsResponseSchema.parse(response).status).toBe("failed");
  });

  it("maps non-ok Nuthatch with retained freshness to unavailable publicly", () => {
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, graphPoolB], "24h"),
      {
        rankedBy: "volume_usd",
      },
    );
    const nuthatchError = {
      source_id: "nuthatch-pool-swaps",
      source_type: "nuthatch_view" as const,
      protocol: "uniswap-v3",
      chain_id: 8453 as const,
      status: "error" as const,
      data: null,
      freshness: {
        indexed_block: 1,
        indexed_block_timestamp: 1_700_000_000,
        indexed_block_hash: `0x${"a".repeat(64)}`,
        queried_at: 1_700_000_010,
      },
      provenance: {
        deployment_or_view_id: "live-nuthatch-view",
        schema_version: null,
        methodology_version: null,
        query_id: "nuthatch-pool-swap-freshness-v1",
      },
      warnings: ["nuthatch error"],
      latency_ms: 1,
    };

    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [graphPoolA, graphPoolB],
      nuthatchResult: nuthatchError,
    });

    expect(response.status).toBe("partial");
    expect(response.data?.nuthatch_freshness_fact).toBeNull();
    expect(response.coverage.nuthatch_available).toBe(false);
    expect(response.freshness[2]).toEqual({
      source_id: "nuthatch-pool-swaps",
      status: "unavailable",
    });
    expect(comparePoolsResponseSchema.parse(response).status).toBe("partial");
  });

  it("emits a Top-N truncation warning when ranked pools are below ok Graph count", () => {
    const pools = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, graphPoolB], "24h"),
      {
        rankedBy: "volume_usd",
        topN: 1,
      },
    );
    const response = settleComparePoolsResult({
      pair: livePair,
      window: "24h",
      rankedBy: "volume_usd",
      pools,
      graphResults: [graphPoolA, graphPoolB],
      nuthatchResult: null,
    });

    expect(response.status).toBe("partial");
    expect(response.data?.pools).toHaveLength(1);
    expect(
      response.warnings.some((warning) => warning.includes("Top-N truncated ranked pools")),
    ).toBe(true);
    expect(comparePoolsResponseSchema.parse(response).status).toBe("partial");
  });
});
