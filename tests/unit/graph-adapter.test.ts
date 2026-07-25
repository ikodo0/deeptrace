import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getActiveComparePoolGraphSources } from "../../src/registry/index.js";
import { poolSourceResultSchema } from "../../src/schemas/source-adapter.js";
import {
  fetchComparePoolGraphSource,
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
});
