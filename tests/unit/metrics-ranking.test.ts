import { describe, expect, it } from "vitest";

import {
  M0_POOL_METRICS_METHODOLOGY,
  compareDecimalStrings,
  compareMetricDescNullsLast,
  rankCanonicalPools,
} from "../../src/metrics/index.js";
import {
  bindComparePoolsGraphResults,
  type CanonicalPoolCandidate,
} from "../../src/normalization/index.js";
import { M0_RANKING_TIE_BREAK } from "../../src/policy/index.js";
import { graphPoolA, graphPoolB } from "../fixtures/sources/index.js";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function candidate(
  overrides: Partial<CanonicalPoolCandidate> &
    Pick<CanonicalPoolCandidate, "pool_address" | "protocol" | "source_ids">,
): CanonicalPoolCandidate {
  return {
    chain_id: 8453,
    pair: [
      { chain_id: 8453, address: WETH, symbol: "WETH", decimals: 18 },
      { chain_id: 8453, address: USDC, symbol: "USDC", decimals: 6 },
    ],
    tvl_usd: "100",
    volume_usd: "50",
    fees_usd: "1",
    window: "24h",
    ...overrides,
  };
}

describe("M0 pool metrics methodology", () => {
  it("locks source-reported USD selection and ranking tie-breaks", () => {
    expect(M0_POOL_METRICS_METHODOLOGY.id).toBe("compare-pools-source-reported-usd-v1");
    expect(M0_POOL_METRICS_METHODOLOGY.unit).toBe("usd");
    expect(M0_POOL_METRICS_METHODOLOGY.window_methodology).toBe("completed-utc-days-v1");
    expect([...M0_POOL_METRICS_METHODOLOGY.ranking.tie_break]).toEqual([...M0_RANKING_TIE_BREAK]);
    expect(M0_POOL_METRICS_METHODOLOGY.non_goals).toEqual([
      "apr",
      "apy",
      "fee_to_tvl_ratio_as_yield",
    ]);
  });
});

describe("decimal ranking order", () => {
  it("compares long decimal strings without JavaScript number coercion", () => {
    expect(compareDecimalStrings("9.5", "10")).toBeLessThan(0);
    expect(compareDecimalStrings("10.0", "10")).toBe(0);
    expect(
      compareDecimalStrings(
        "6089724.592920848435197967898475142",
        "1837918.971826772337839586279587621",
      ),
    ).toBeGreaterThan(0);
  });

  it("places null metrics after measured values when ranking descending", () => {
    expect(compareMetricDescNullsLast("1", null)).toBeLessThan(0);
    expect(compareMetricDescNullsLast(null, "1")).toBeGreaterThan(0);
    expect(compareMetricDescNullsLast(null, null)).toBe(0);
    expect(compareMetricDescNullsLast("2", "10")).toBeGreaterThan(0);
  });
});

describe("rankCanonicalPools", () => {
  it("ranks live Graph fixtures by volume_usd descending independent of input order", () => {
    const forward = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolA, graphPoolB], "24h"),
      {
        rankedBy: "volume_usd",
      },
    );
    const reversed = rankCanonicalPools(
      bindComparePoolsGraphResults([graphPoolB, graphPoolA], "24h"),
      { rankedBy: "volume_usd" },
    );

    expect(forward.map((pool) => pool.source_ids[0])).toEqual([
      "exchange-v3-base",
      "uniswap-v3-base-native",
    ]);
    expect(reversed).toEqual(forward);
    expect(forward.map((pool) => pool.rank)).toEqual([1, 2]);
    expect(forward[0]?.volume_usd).toBe(graphPoolB.data.volume_usd_24h);
  });

  it("applies protocol, pool address, then source_id tie-breaks", () => {
    const tied = rankCanonicalPools(
      [
        candidate({
          protocol: "protocol-b",
          pool_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source_ids: ["source-b"],
          volume_usd: "100",
        }),
        candidate({
          protocol: "protocol-a",
          pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source_ids: ["source-z"],
          volume_usd: "100",
        }),
        candidate({
          protocol: "protocol-a",
          pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source_ids: ["source-a"],
          volume_usd: "100",
        }),
      ],
      { rankedBy: "volume_usd" },
    );

    // Same pool address collapses via dedupe first (least source_id primary).
    expect(tied).toHaveLength(2);
    expect(tied[0]?.protocol).toBe("protocol-a");
    expect(tied[0]?.source_ids).toEqual(["source-a", "source-z"]);
    expect(tied[1]?.protocol).toBe("protocol-b");
  });

  it("keeps null requested metrics after measured values and respects Top-N", () => {
    const ranked = rankCanonicalPools(
      [
        candidate({
          protocol: "protocol-a",
          pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source_ids: ["a"],
          volume_usd: null,
          tvl_usd: "999",
        }),
        candidate({
          protocol: "protocol-b",
          pool_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source_ids: ["b"],
          volume_usd: "10",
        }),
        candidate({
          protocol: "protocol-c",
          pool_address: "0xcccccccccccccccccccccccccccccccccccccccc",
          source_ids: ["c"],
          volume_usd: "5",
        }),
      ],
      { rankedBy: "volume_usd", topN: 2 },
    );

    expect(ranked.map((pool) => pool.source_ids[0])).toEqual(["b", "c"]);
    expect(ranked).toHaveLength(2);
  });

  it("ranks by tvl_usd and fees_usd when requested", () => {
    const byTvl = rankCanonicalPools(
      [
        candidate({
          protocol: "protocol-a",
          pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source_ids: ["a"],
          tvl_usd: "10",
          volume_usd: "1000",
        }),
        candidate({
          protocol: "protocol-b",
          pool_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source_ids: ["b"],
          tvl_usd: "20",
          volume_usd: "1",
        }),
      ],
      { rankedBy: "tvl_usd" },
    );
    expect(byTvl[0]?.source_ids).toEqual(["b"]);

    const byFees = rankCanonicalPools(
      [
        candidate({
          protocol: "protocol-a",
          pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          source_ids: ["a"],
          fees_usd: "3",
        }),
        candidate({
          protocol: "protocol-b",
          pool_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source_ids: ["b"],
          fees_usd: "9",
        }),
      ],
      { rankedBy: "fees_usd" },
    );
    expect(byFees[0]?.source_ids).toEqual(["b"]);
  });

  it("rejects invalid topN and mixed windows", () => {
    expect(() =>
      rankCanonicalPools(
        [
          candidate({
            protocol: "protocol-a",
            pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            source_ids: ["a"],
          }),
        ],
        { rankedBy: "volume_usd", topN: 4 },
      ),
    ).toThrow(/topN/);

    expect(() =>
      rankCanonicalPools(
        [
          candidate({
            protocol: "protocol-a",
            pool_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            source_ids: ["a"],
            window: "24h",
          }),
          candidate({
            protocol: "protocol-b",
            pool_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            source_ids: ["b"],
            window: "7d",
          }),
        ],
        { rankedBy: "volume_usd" },
      ),
    ).toThrow(/mixed windows/);
  });
});
