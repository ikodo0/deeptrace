import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getActiveComparePoolGraphSources } from "../../src/registry/index.js";
import { poolSourceResultSchema } from "../../src/schemas/source-adapter.js";
import {
  fetchComparePoolGraphSource,
  TIER_B_METRICS_QUERY,
  TIER_B_METRICS_QUERY_ID,
} from "../../src/sources/graph/index.js";
import { sumDecimals } from "../../src/sources/graph/decimal.js";

const evidenceRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/__evidence__/m2",
);

async function loadEvidenceData(sourceDir: string): Promise<unknown> {
  const raw = JSON.parse(
    await readFile(path.join(evidenceRoot, sourceDir, "07-common-metrics.json"), "utf8"),
  ) as { response: { data: unknown } };
  return raw.response.data;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchComparePoolGraphSource", () => {
  const [uniswap, pancake] = getActiveComparePoolGraphSources();

  it("maps Uniswap live evidence into an ok PoolSourceResult with exact 7d sums", async () => {
    expect(uniswap).toBeDefined();
    const data = await loadEvidenceData("uniswap-v3-base-native");
    const dayDatas = (
      data as {
        poolDayDatas: Array<{ date: number; volumeUSD: string; feesUSD: string }>;
      }
    ).poolDayDatas;
    const newest = dayDatas[0];
    expect(newest).toBeDefined();
    // Make the newest captured day a completed UTC day for aggregation.
    const nowSeconds = newest!.date + 86_400 + 1;

    let observedUrl = "";
    let observedAuthorization = "";
    const fetchImpl: typeof fetch = (input, init) => {
      observedUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(jsonResponse({ data }));
    };

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "test-credential-must-not-leak",
      fetchImpl,
      nowSeconds,
    });

    expect(poolSourceResultSchema.parse(result).status).toBe("ok");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    expect(result.source_id).toBe("uniswap-v3-base-native");
    expect(result.source_type).toBe("native_subgraph");
    expect(result.protocol).toBe("uniswap-v3");
    expect(result.data.pool_address).toBe("0x6c561b446416e1a00e8e93e221854d6ea4171372");
    expect(result.data.fee_tier_bps).toBe(30);
    expect(result.data.tvl_usd).toBe("150700095.7707237035076119974091172");
    expect(result.data.volume_usd_24h).toBe(dayDatas[0]!.volumeUSD);
    expect(result.data.fees_usd_24h).toBe(dayDatas[0]!.feesUSD);
    expect(result.data.volume_usd_7d).toBe(sumDecimals(dayDatas.map((day) => day.volumeUSD)));
    expect(result.data.fees_usd_7d).toBe(sumDecimals(dayDatas.map((day) => day.feesUSD)));
    expect(result.freshness.indexed_block).toBe(49095773);
    expect(result.provenance.query_id).toBe(TIER_B_METRICS_QUERY_ID);
    expect(result.provenance.deployment_or_view_id).toBe(
      "QmVeyHjXivX8mY7bzWdbHDyA5z9ojgJdTu6uwFJsJvUzYR",
    );
    expect(observedUrl).toContain("/subgraphs/id/GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz");
    expect(observedUrl).not.toContain("test-credential");
    expect(observedAuthorization).toBe("Bearer test-credential-must-not-leak");
    expect(JSON.stringify(result)).not.toContain("test-credential");
  });

  it("maps PancakeSwap live evidence and fee tier 100 → 1 bps", async () => {
    expect(pancake).toBeDefined();
    const data = await loadEvidenceData("exchange-v3-base");
    const dayDatas = (data as { poolDayDatas: Array<{ date: number }> }).poolDayDatas;
    const nowSeconds = dayDatas[0]!.date + 86_400 + 1;

    const result = await fetchComparePoolGraphSource(pancake!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.source_id).toBe("exchange-v3-base");
    expect(result.data.fee_tier_bps).toBe(1);
    expect(result.data.pool_address).toBe("0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38");
  });

  it("excludes the current partial UTC day from 24h aggregates", async () => {
    const data = structuredClone(await loadEvidenceData("uniswap-v3-base-native")) as {
      poolDayDatas: Array<{ date: number; volumeUSD: string; feesUSD: string }>;
    };
    const nowSeconds = data.poolDayDatas[0]!.date + 3_600;

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.volume_usd_24h).toBe(data.poolDayDatas[1]!.volumeUSD);
    expect(result.data.fees_usd_24h).toBe(data.poolDayDatas[1]!.feesUSD);
    expect(result.data.volume_usd_7d).toBeNull();
    expect(result.data.fees_usd_7d).toBeNull();
  });

  it("requests eight day snapshots so seven completed days survive the partial day", () => {
    // The newest poolDayDatas row is the in-progress UTC day, which
    // aggregation discards. Fetching seven would leave six completed days and
    // make the 7d window permanently null in production.
    expect(TIER_B_METRICS_QUERY_ID).toBe("m3-tier-b-metrics-v2");
    expect(TIER_B_METRICS_QUERY).toContain("first: 8");
  });

  it("sums 7d over completed days when the newest row is the partial day", async () => {
    expect(uniswap).toBeDefined();
    const data = structuredClone(await loadEvidenceData("uniswap-v3-base-native")) as {
      poolDayDatas: Array<{ date: number; volumeUSD: string; feesUSD: string; tvlUSD?: string }>;
    };

    // Evidence holds seven rows, newest first. Production now fetches eight, so
    // append one older day: the newest stays partial and seven complete days
    // remain — exactly the shape the live query returns.
    const oldest = data.poolDayDatas[data.poolDayDatas.length - 1]!;
    data.poolDayDatas.push({
      ...oldest,
      date: oldest.date - 86_400,
      volumeUSD: "1000.5",
      feesUSD: "3.0015",
    });
    expect(data.poolDayDatas).toHaveLength(8);

    const newest = data.poolDayDatas[0]!;
    // Mid-way through the newest day, so that row is not a completed day.
    const nowSeconds = newest.date + 3_600;

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    const completed = data.poolDayDatas.slice(1);
    expect(completed).toHaveLength(7);
    expect(result.data.volume_usd_7d).toBe(sumDecimals(completed.map((day) => day.volumeUSD)));
    expect(result.data.fees_usd_7d).toBe(sumDecimals(completed.map((day) => day.feesUSD)));
    // The 24h window still tracks only the most recent completed day.
    expect(result.data.volume_usd_24h).toBe(completed[0]!.volumeUSD);
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

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.status).toBe("timeout");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
    expect(result.warnings[0]).toMatch(/timeout/i);
  });

  it("returns unsupported with retained freshness on deployment mismatch", async () => {
    const data = structuredClone(await loadEvidenceData("uniswap-v3-base-native")) as {
      _meta: { deployment: string };
    };
    data._meta.deployment = "QmWrongDeploymentHashxxxxxxxxxxxxxxxxxxxxxxxxx";

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds: 1_785_024_001,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.provenance.deployment_or_view_id).toBe(data._meta.deployment);
    expect(result.warnings[0]).toMatch(/deployment mismatch/i);
  });

  it("returns unsupported when the pool entity is null", async () => {
    const data = structuredClone(await loadEvidenceData("uniswap-v3-base-native")) as {
      pool: unknown;
    };
    data.pool = null;

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
  });

  it("returns error when GRAPH_API_KEY is missing", async () => {
    let called = false;
    const result = await fetchComparePoolGraphSource(uniswap!, {
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

  it("returns unsupported for a non-locked query_id without calling the network", async () => {
    let called = false;
    const result = await fetchComparePoolGraphSource(
      {
        ...uniswap!,
        query_id: "other-query-v1",
      },
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
    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ errors: [{ message: "boom" }], data: null })),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
  });

  it("returns error on HTTP non-2xx gateway responses", async () => {
    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ message: "nope" }, 503)),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });

  it("returns error on transport failures", async () => {
    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.reject(new TypeError("network down")),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/redacted/i);
    expect(JSON.stringify(result)).not.toMatch(/network down/);
  });

  it("returns unsupported when pool tokens disagree with the locked pair", async () => {
    const data = structuredClone(await loadEvidenceData("uniswap-v3-base-native")) as {
      pool: { token1: { id: string; symbol: string; decimals: string } };
    };
    data.pool.token1 = {
      id: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
      symbol: "USDbC",
      decimals: "6",
    };

    const result = await fetchComparePoolGraphSource(uniswap!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ data })),
      nowSeconds: 1_785_024_001,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/tokens do not match/i);
  });
});
