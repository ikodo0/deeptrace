import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getActiveComparePoolGraphSources,
  type ComparePoolGraphSource,
} from "../../src/registry/index.js";
import { poolSourceResultSchema } from "../../src/schemas/source-adapter.js";
import {
  fetchComparePoolGraphSource,
  TIER_A_METRICS_QUERY,
  TIER_A_METRICS_QUERY_ID,
  TIER_B_METRICS_QUERY,
  TIER_B_METRICS_QUERY_ID,
} from "../../src/sources/graph/index.js";
import { sumDecimals } from "../../src/sources/graph/decimal.js";

const evidenceRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/__evidence__",
);

const SECONDS_PER_DAY = 86_400;

interface TierACapture {
  readonly request: { readonly query: string };
  readonly response: {
    readonly data: {
      readonly liquidityPool: { readonly id: string };
      readonly liquidityPoolDailySnapshots: {
        day: number;
        dailyVolumeUSD: string;
        dailyTotalRevenueUSD: string;
      }[];
      readonly _meta: { deployment: string };
    };
  };
}

async function loadTierACapture(sourceId: string): Promise<TierACapture> {
  return JSON.parse(
    await readFile(path.join(evidenceRoot, "m3", sourceId, "01-pool-metrics.json"), "utf8"),
  ) as TierACapture;
}

async function loadTierBData(sourceDir: string): Promise<Record<string, unknown>> {
  const raw = JSON.parse(
    await readFile(path.join(evidenceRoot, "m2", sourceDir, "07-common-metrics.json"), "utf8"),
  ) as { response: { data: Record<string, unknown> } };
  return raw.response.data;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A Tier-B binding is not shipped in any profile today, so it is synthesized
 * from the M2 native evidence to keep the second schema tier under test.
 */
const tierBSource: ComparePoolGraphSource = {
  profile_id: "test-tier-b-v1",
  source_id: "uniswap-v3-base-native",
  priority: 1,
  pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
  token0: "0x4200000000000000000000000000000000000006",
  token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  window_methodology: "completed-utc-days-v1",
  query_id: TIER_B_METRICS_QUERY_ID,
  schema_contract_id: TIER_B_METRICS_QUERY_ID,
  record: {
    source_id: "uniswap-v3-base-native",
    category: "dex",
    protocol: "uniswap-v3",
    chain_id: 8453,
    source_type: "native_subgraph",
    deployment_or_view_id: "QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR",
    schema_version: null,
    methodology_version: null,
    supported_entities: ["pools", "poolDayDatas", "tokens"],
    status: "active",
    locator: {
      kind: "graph_subgraph",
      gateway_host: "gateway.thegraph.com",
      subgraph_id: "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz",
    },
  },
};

describe("fetchComparePoolGraphSource on the Messari dex-amm standard", () => {
  const [feeHigh, feeLow] = getActiveComparePoolGraphSources();

  it("ships the captured query text, so replayed evidence matches production", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");

    expect(capture.request.query).toBe(TIER_A_METRICS_QUERY);
  });

  it("requests eight day snapshots so seven completed days survive the partial day", () => {
    // The newest snapshot row can be the in-progress UTC day, which
    // aggregation discards. Fetching seven would leave six completed days and
    // make the 7d window permanently null in production.
    expect(TIER_A_METRICS_QUERY).toContain("first: 8");
  });

  it("maps 0.3%-tier live evidence into an ok PoolSourceResult with exact 7d sums", async () => {
    expect(feeHigh).toBeDefined();
    const { response } = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const snapshots = response.data.liquidityPoolDailySnapshots;
    // Make the newest captured day the in-progress day so seven complete.
    const nowSeconds = snapshots[0]!.day * SECONDS_PER_DAY + 3_600;
    const completed = snapshots.slice(1);

    let observedUrl = "";
    let observedAuthorization = "";
    const fetchImpl: typeof fetch = (input, init) => {
      observedUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(jsonResponse(response));
    };

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "test-credential-must-not-leak",
      fetchImpl,
      nowSeconds,
    });

    expect(poolSourceResultSchema.parse(result).status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    expect(result.source_id).toBe("messari-uniswap-v3-base-fee030");
    expect(result.source_type).toBe("standardized_subgraph");
    expect(result.protocol).toBe("uniswap-v3");
    expect(result.data.pool_address).toBe("0x6c561b446416e1a00e8e93e221854d6ea4171372");
    expect(result.data.fee_tier_bps).toBe(30);
    expect(result.data.tvl_usd).toBe("114861166.2464289945430831254042441");
    expect(result.data.token0).toEqual({
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
    });
    expect(result.data.token1.symbol).toBe("USDC");
    expect(result.data.volume_usd_24h).toBe(completed[0]!.dailyVolumeUSD);
    expect(result.data.fees_usd_24h).toBe(completed[0]!.dailyTotalRevenueUSD);
    expect(result.data.volume_usd_7d).toBe(sumDecimals(completed.map((day) => day.dailyVolumeUSD)));
    expect(result.data.fees_usd_7d).toBe(
      sumDecimals(completed.map((day) => day.dailyTotalRevenueUSD)),
    );
    expect(result.freshness.indexed_block).toBe(49121447);
    expect(result.provenance.query_id).toBe(TIER_A_METRICS_QUERY_ID);
    expect(result.provenance.schema_version).toBe("4.0.1");
    expect(result.provenance.methodology_version).toBe("1.0.0");
    expect(result.provenance.deployment_or_view_id).toBe(
      "QmawEzRNeDyaTgjPKb1eRrbyzxczgSHUYzvTMaMnN8jyuh",
    );
    expect(observedUrl).toContain("/subgraphs/id/FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS");
    expect(observedUrl).not.toContain("test-credential");
    expect(observedAuthorization).toBe("Bearer test-credential-must-not-leak");
    expect(JSON.stringify(result)).not.toContain("test-credential");
  });

  it("maps the 0.05% tier from the same deployment and reads fee percentage 0.05 as 5 bps", async () => {
    expect(feeLow).toBeDefined();
    const { response } = await loadTierACapture("messari-uniswap-v3-base-fee005");
    const snapshots = response.data.liquidityPoolDailySnapshots;

    const result = await fetchComparePoolGraphSource(feeLow!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
      nowSeconds: snapshots[0]!.day * SECONDS_PER_DAY + 3_600,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.source_id).toBe("messari-uniswap-v3-base-fee005");
    expect(result.data.pool_address).toBe("0xd0b53d9277642d899df5c87a3966a349a798f224");
    expect(result.data.fee_tier_bps).toBe(5);
  });

  it("converts snapshot day numbers into UTC-midnight day ids", async () => {
    const { response } = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const snapshots = response.data.liquidityPoolDailySnapshots;
    // One hour past the newest captured day's midnight: that day is still in
    // progress, so 24h must fall back to the day before it.
    const nowSeconds = snapshots[0]!.day * SECONDS_PER_DAY + 3_600;

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
      nowSeconds,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.volume_usd_24h).toBe(snapshots[1]!.dailyVolumeUSD);
    expect(result.data.volume_usd_24h).not.toBe(snapshots[0]!.dailyVolumeUSD);
  });

  it("reports a null fee tier rather than rounding a sub-basis-point percentage", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const response = structuredClone(capture.response) as unknown as {
      data: { liquidityPool: { fees: { feePercentage: string; feeType: string }[] } };
    };
    for (const fee of response.data.liquidityPool.fees) {
      if (fee.feeType === "FIXED_TRADING_FEE") {
        fee.feePercentage = "0.001";
      }
    }

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
      nowSeconds:
        capture.response.data.liquidityPoolDailySnapshots[0]!.day * SECONDS_PER_DAY + 3_600,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.fee_tier_bps).toBeNull();
  });

  it("returns unsupported when the pool is not a two-token pool", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const response = structuredClone(capture.response) as unknown as {
      data: { liquidityPool: { inputTokens: unknown[] } };
    };
    response.data.liquidityPool.inputTokens.push({
      id: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      symbol: "USDbC",
      decimals: 6,
    });

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/shape validation/i);
  });

  it("returns unsupported when pool tokens disagree with the locked pair", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const response = structuredClone(capture.response) as unknown as {
      data: { liquidityPool: { inputTokens: { id: string; symbol: string; decimals: number }[] } };
    };
    response.data.liquidityPool.inputTokens[1] = {
      id: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      symbol: "USDbC",
      decimals: 6,
    };

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/tokens do not match/i);
  });

  it("returns unsupported with retained freshness on deployment mismatch", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const response = structuredClone(capture.response) as unknown as {
      data: { _meta: { deployment: string } };
    };
    response.data._meta.deployment = "QmWrongDeploymentHashxxxxxxxxxxxxxxxxxxxxxxxxx";

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.provenance.deployment_or_view_id).toBe(response.data._meta.deployment);
    expect(result.warnings[0]).toMatch(/deployment mismatch/i);
  });

  it("returns unsupported when the pool entity is null", async () => {
    const capture = await loadTierACapture("messari-uniswap-v3-base-fee030");
    const response = structuredClone(capture.response) as unknown as {
      data: { liquidityPool: unknown };
    };
    response.data.liquidityPool = null;

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse(response)),
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
  });

  it("returns timeout without freshness when the gateway aborts", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.status).toBe("timeout");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
    expect(result.warnings[0]).toMatch(/timeout/i);
  });

  it("returns error when GRAPH_API_KEY is missing", async () => {
    let called = false;
    const result = await fetchComparePoolGraphSource(feeHigh!, {
      env: {},
      fetchImpl: () => {
        called = true;
        return Promise.resolve(jsonResponse({ data: {} }));
      },
    });

    expect(called).toBe(false);
    expect(result.status).toBe("error");
    expect(result.warnings[0]).toMatch(/GRAPH_API_KEY/);
  });

  it("returns unsupported for an unimplemented query_id without calling the network", async () => {
    let called = false;
    const result = await fetchComparePoolGraphSource(
      { ...feeHigh!, query_id: "other-query-v1" },
      {
        apiKey: "key",
        fetchImpl: () => {
          called = true;
          return Promise.resolve(jsonResponse({ data: {} }));
        },
      },
    );

    expect(called).toBe(false);
    expect(result.status).toBe("unsupported");
  });

  it("returns error on GraphQL errors without inventing pool data", async () => {
    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ errors: [{ message: "boom" }], data: null })),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
  });

  it("returns error on HTTP non-2xx gateway responses", async () => {
    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ message: "nope" }, 503)),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });

  it("returns error on transport failures", async () => {
    const result = await fetchComparePoolGraphSource(feeHigh!, {
      apiKey: "key",
      fetchImpl: () => Promise.reject(new TypeError("network down")),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/redacted/i);
    expect(JSON.stringify(result)).not.toMatch(/network down/);
  });
});

describe("fetchComparePoolGraphSource on the native Tier-B schema", () => {
  it("still maps native poolDayDatas evidence, including string token decimals", async () => {
    const data = await loadTierBData("uniswap-v3-base-native");
    const dayDatas = (data as { poolDayDatas: { date: number; volumeUSD: string }[] }).poolDayDatas;

    const result = await fetchComparePoolGraphSource(tierBSource, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds: dayDatas[0]!.date + 86_400 + 1,
    });

    expect(poolSourceResultSchema.parse(result).status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.source_type).toBe("native_subgraph");
    expect(result.data.fee_tier_bps).toBe(30);
    expect(result.data.token0.decimals).toBe(18);
    expect(result.data.volume_usd_24h).toBe(dayDatas[0]!.volumeUSD);
  });

  it("reads fee tier 100 as 1 bps on the PancakeSwap capture", async () => {
    const data = await loadTierBData("exchange-v3-base");
    const dayDatas = (data as { poolDayDatas: { date: number }[] }).poolDayDatas;
    const pancakeSource: ComparePoolGraphSource = {
      ...tierBSource,
      source_id: "exchange-v3-base",
      pool_address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
      record: {
        ...tierBSource.record,
        source_id: "exchange-v3-base",
        protocol: "pancakeswap-v3",
        deployment_or_view_id: "QmQ1fMMrEjnmeDXn7BZMhWtFZYUQQuiDJrJP3c9oghRC9g",
        locator: {
          ...tierBSource.record.locator,
          subgraph_id: "BHWNsedAHtmTCzXxCCDfhPmm6iN9rxUhoRHdHKyujic3",
        },
      },
    };

    const result = await fetchComparePoolGraphSource(pancakeSource, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds: dayDatas[0]!.date + 86_400 + 1,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.fee_tier_bps).toBe(1);
  });

  it("keeps requesting eight native day rows", () => {
    expect(TIER_B_METRICS_QUERY).toContain("first: 8");
  });
});
