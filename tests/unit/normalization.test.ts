import { describe, expect, it } from "vitest";

import {
  DUPLICATE_POOL_COLLAPSE_POLICY,
  NormalizationError,
  convertPoolSourceResult,
  deduplicateCanonicalPools,
  normalizeAddress,
  normalizeCanonicalPair,
  pairIdentity,
  poolIdentity,
  toPoolComparisonRecord,
  tokenIdentity,
  type CanonicalPoolCandidate,
} from "../../src/normalization/index.js";
import { graphPoolA, graphPoolC, graphPoolCTimeout } from "../fixtures/sources/index.js";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MIXED_CASE_WETH = "0x4200000000000000000000000000000000000006"
  .split("")
  .map((char, index) => (index > 1 && index % 2 === 0 ? char.toUpperCase() : char))
  .join("");
const MIXED_CASE_USDC = "0x833589FCd6EdB6E08F4C7C32D4F71B54BDA02913";
const POOL_A = "0x00000000000000000000000000000000000000a1";
const MIXED_CASE_POOL_A = "0x00000000000000000000000000000000000000A1";
const POOL_B = "0x00000000000000000000000000000000000000b2";

function candidateFixture(
  overrides: Partial<CanonicalPoolCandidate> &
    Pick<CanonicalPoolCandidate, "pool_address" | "source_ids">,
): CanonicalPoolCandidate {
  return {
    chain_id: 8453,
    protocol: "fixture-dex-a",
    pair: [
      {
        chain_id: 8453,
        address: WETH,
        symbol: "WETH",
        decimals: 18,
      },
      {
        chain_id: 8453,
        address: USDC,
        symbol: "USDC",
        decimals: 6,
      },
    ],
    tvl_usd: "100",
    volume_usd: "50",
    fees_usd: "1",
    window: "24h",
    ...overrides,
  };
}

describe("address normalization", () => {
  it("lowercases mixed-case addresses", () => {
    expect(normalizeAddress(MIXED_CASE_WETH)).toBe(WETH);
    expect(normalizeAddress(MIXED_CASE_USDC)).toBe(USDC);
    expect(normalizeAddress(MIXED_CASE_POOL_A)).toBe(POOL_A);
  });

  it("rejects invalid addresses", () => {
    for (const address of [
      "0xnot-an-address",
      "0x1234",
      "4200000000000000000000000000000000000006",
      "0x420000000000000000000000000000000000000g",
      "",
    ]) {
      expect(() => normalizeAddress(address)).toThrow(NormalizationError);
    }
  });
});

describe("chain-aware identities", () => {
  it("treats token and pool identities as casing-insensitive", () => {
    expect(tokenIdentity(8453, MIXED_CASE_WETH)).toBe(tokenIdentity(8453, WETH));
    expect(poolIdentity(8453, MIXED_CASE_POOL_A)).toBe(poolIdentity(8453, POOL_A));
  });

  it("keeps identities chain-aware and rejects mixed identical pair legs", () => {
    expect(tokenIdentity(8453, WETH)).not.toBe(tokenIdentity(1, WETH));
    expect(poolIdentity(8453, POOL_A)).not.toBe(poolIdentity(1, POOL_A));
    expect(() => pairIdentity(8453, WETH, MIXED_CASE_WETH)).toThrow(NormalizationError);
  });

  it("builds the same pair identity regardless of token order or casing", () => {
    expect(pairIdentity(8453, MIXED_CASE_WETH, MIXED_CASE_USDC)).toBe(
      pairIdentity(8453, USDC, WETH),
    );
    expect(pairIdentity(8453, WETH, USDC)).toBe(`8453:${WETH}:${USDC}`);
  });
});

describe("canonical pair ordering", () => {
  it("orders pairs by address independent of source token order and casing", () => {
    const forward = normalizeCanonicalPair(
      8453,
      { address: MIXED_CASE_WETH, symbol: "WETH", decimals: 18 },
      { address: MIXED_CASE_USDC, symbol: "USDC", decimals: 6 },
    );
    const reversed = normalizeCanonicalPair(
      8453,
      { address: USDC, symbol: "USDC", decimals: 6 },
      { address: WETH, symbol: "WETH", decimals: 18 },
    );

    expect(forward).toEqual(reversed);
    expect(forward[0]?.address).toBe(WETH);
    expect(forward[1]?.address).toBe(USDC);
    expect(pairIdentity(8453, forward[0].address, forward[1].address)).toBe(
      pairIdentity(8453, reversed[0].address, reversed[1].address),
    );
  });

  it("rejects token decimals outside the canonical schema boundary", () => {
    expect(() =>
      normalizeCanonicalPair(
        8453,
        { address: WETH, symbol: "WETH", decimals: 256 },
        { address: USDC, symbol: "USDC", decimals: 6 },
      ),
    ).toThrow(NormalizationError);
  });
});

describe("pool source conversion", () => {
  it("selects 24h and 7d metrics without rewriting other fields", () => {
    const day = convertPoolSourceResult(graphPoolA, "24h");
    const week = convertPoolSourceResult(graphPoolA, "7d");

    expect(day).not.toBeNull();
    expect(week).not.toBeNull();
    expect(day?.tvl_usd).toBe(graphPoolA.data.tvl_usd);
    expect(day?.volume_usd).toBe(graphPoolA.data.volume_usd_24h);
    expect(day?.fees_usd).toBe(graphPoolA.data.fees_usd_24h);
    expect(day?.window).toBe("24h");
    expect(week?.volume_usd).toBe(graphPoolA.data.volume_usd_7d);
    expect(week?.fees_usd).toBe(graphPoolA.data.fees_usd_7d);
    expect(week?.window).toBe("7d");
  });

  it("canonicalizes reversed source token order to the same pair identity", () => {
    const forward = convertPoolSourceResult(graphPoolA, "24h");
    const reversed = convertPoolSourceResult(
      {
        ...graphPoolA,
        data: {
          ...graphPoolA.data,
          token0: graphPoolA.data.token1,
          token1: graphPoolA.data.token0,
        },
      },
      "24h",
    );

    expect(forward?.pair).toEqual(reversed?.pair);
    expect(pairIdentity(8453, forward!.pair[0].address, forward!.pair[1].address)).toBe(
      pairIdentity(8453, reversed!.pair[0].address, reversed!.pair[1].address),
    );
  });

  it("passes high-precision decimals through unchanged and never via floating point", () => {
    const precise = "123456789012345678901234567890.123456789012345678901234567890";
    const result = {
      ...graphPoolA,
      data: {
        ...graphPoolA.data,
        tvl_usd: precise,
        volume_usd_24h: precise,
        fees_usd_24h: "0",
      },
    };

    const converted = convertPoolSourceResult(result, "24h");
    expect(converted?.tvl_usd).toBe(precise);
    expect(converted?.volume_usd).toBe(precise);
    expect(converted?.fees_usd).toBe("0");
    expect(converted?.tvl_usd).not.toBe(Number(precise));
    expect(typeof converted?.tvl_usd).toBe("string");
  });

  it("preserves measured zero as distinct from null", () => {
    const withZero = {
      ...graphPoolC,
      data: {
        ...graphPoolC.data,
        tvl_usd: "0",
        volume_usd_24h: "0",
        fees_usd_24h: null,
        volume_usd_7d: null,
        fees_usd_7d: "0",
      },
    };

    const day = convertPoolSourceResult(withZero, "24h");
    const week = convertPoolSourceResult(withZero, "7d");

    expect(day?.tvl_usd).toBe("0");
    expect(day?.volume_usd).toBe("0");
    expect(day?.fees_usd).toBeNull();
    expect(week?.volume_usd).toBeNull();
    expect(week?.fees_usd).toBe("0");
    expect(day?.fees_usd).not.toBe(day?.volume_usd);
  });

  it("does not convert failed source results", () => {
    expect(convertPoolSourceResult(graphPoolCTimeout, "24h")).toBeNull();
    expect(convertPoolSourceResult(graphPoolCTimeout, "7d")).toBeNull();
  });

  it("rejects windows outside the explicit normalization boundary", () => {
    expect(() => convertPoolSourceResult(graphPoolA, "30d" as never)).toThrow(NormalizationError);
  });

  it("keeps canonical candidates rank-free and requires an explicit rank boundary", () => {
    const candidate = convertPoolSourceResult(graphPoolA, "24h");
    expect(candidate).not.toBeNull();
    expect(candidate).not.toHaveProperty("rank");

    const ranked = toPoolComparisonRecord(candidate!, 1);
    expect(ranked.rank).toBe(1);
    expect(ranked.source_ids).toEqual(candidate!.source_ids);
    expect(() => toPoolComparisonRecord(candidate!, 0)).toThrow(NormalizationError);
  });
});

describe("deterministic pool deduplication", () => {
  it("collapses the same chain+pool address under reversed input order", () => {
    const first = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-graph-dex-b"],
      tvl_usd: "200",
      volume_usd: "80",
      fees_usd: "2",
      protocol: "fixture-dex-b",
    });
    const second = candidateFixture({
      pool_address: MIXED_CASE_POOL_A,
      source_ids: ["fixture-graph-dex-a"],
      tvl_usd: "100",
      volume_usd: "50",
      fees_usd: "1",
      protocol: "fixture-dex-a",
    });

    const forward = deduplicateCanonicalPools([first, second]);
    const reversed = deduplicateCanonicalPools([second, first]);

    expect(forward).toEqual(reversed);
    expect(forward).toHaveLength(1);
    expect(forward[0]?.pool_address).toBe(POOL_A);
    expect(forward[0]?.pair.map(({ address }) => address)).toEqual([WETH, USDC]);
    expect(forward[0]?.source_ids).toEqual(["fixture-graph-dex-a", "fixture-graph-dex-b"]);
  });

  it("canonicalizes primary pair address casing during duplicate collapse", () => {
    const mixedCasePair = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-a"],
      pair: [
        {
          chain_id: 8453,
          address: MIXED_CASE_WETH,
          symbol: "WETH",
          decimals: 18,
        },
        {
          chain_id: 8453,
          address: MIXED_CASE_USDC,
          symbol: "USDC",
          decimals: 6,
        },
      ],
    });

    const [deduplicated] = deduplicateCanonicalPools([mixedCasePair]);
    expect(deduplicated?.pair.map(({ address }) => address)).toEqual([WETH, USDC]);
  });

  it("sorts unique source IDs and applies the explicit conflict policy", () => {
    expect(DUPLICATE_POOL_COLLAPSE_POLICY).toBe(
      "primary_by_least_source_id_passthrough_metrics_merge_sorted_source_ids",
    );

    const laterSource = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["z-source", "m-source"],
      tvl_usd: "999",
      volume_usd: "999",
      fees_usd: "999",
      protocol: "should-not-win",
    });
    const earlierSource = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["a-source", "a-source"],
      tvl_usd: "10",
      volume_usd: "20",
      fees_usd: "0",
      protocol: "primary-protocol",
    });

    const [merged] = deduplicateCanonicalPools([laterSource, earlierSource]);

    expect(merged?.protocol).toBe("primary-protocol");
    expect(merged?.tvl_usd).toBe("10");
    expect(merged?.volume_usd).toBe("20");
    expect(merged?.fees_usd).toBe("0");
    expect(merged?.source_ids).toEqual(["a-source", "m-source", "z-source"]);
    expect(merged?.tvl_usd).not.toBe("504.5");
    expect(merged?.volume_usd).not.toBe("1019");
  });

  it("uses a total deterministic tie-breaker when duplicate source IDs match", () => {
    const first = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["same-source"],
      tvl_usd: "20",
    });
    const second = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["same-source"],
      tvl_usd: "10",
    });

    const forward = deduplicateCanonicalPools([first, second]);
    expect(forward).toEqual(deduplicateCanonicalPools([second, first]));
    expect(forward[0]?.tvl_usd).toBe("10");
  });

  it("does not fill a primary null financial value from a duplicate", () => {
    const secondary = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["z-source"],
      volume_usd: "500",
    });
    const primary = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["a-source"],
      volume_usd: null,
    });

    const [merged] = deduplicateCanonicalPools([secondary, primary]);
    expect(merged?.volume_usd).toBeNull();
  });

  it("rejects duplicate pool identities with incompatible pairs or windows", () => {
    const base = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-a"],
    });
    const differentPair = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-b"],
      pair: [
        base.pair[0],
        {
          ...base.pair[1],
          address: "0x9999999999999999999999999999999999999999",
        },
      ],
    });
    const differentWindow = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-c"],
      window: "7d",
    });

    expect(() => deduplicateCanonicalPools([base, differentPair])).toThrow(NormalizationError);
    expect(() => deduplicateCanonicalPools([base, differentWindow])).toThrow(NormalizationError);
  });

  it("does not collapse differing chain or pool identities", () => {
    const basePool = candidateFixture({
      pool_address: POOL_A,
      source_ids: ["fixture-a"],
    });
    const otherPool = candidateFixture({
      pool_address: POOL_B,
      source_ids: ["fixture-b"],
    });

    expect(poolIdentity(8453, POOL_A)).not.toBe(poolIdentity(1, POOL_A));
    expect(poolIdentity(8453, POOL_A)).not.toBe(poolIdentity(8453, POOL_B));
    expect(tokenIdentity(8453, WETH)).not.toBe(tokenIdentity(1, WETH));
    expect(pairIdentity(8453, WETH, USDC)).not.toBe(pairIdentity(1, WETH, USDC));

    const deduped = deduplicateCanonicalPools([basePool, otherPool, basePool]);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((pool) => pool.pool_address)).toEqual([POOL_A, POOL_B]);
    expect(deduped[0]?.source_ids).toEqual(["fixture-a"]);
  });
});
