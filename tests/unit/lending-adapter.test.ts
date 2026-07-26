import { describe, expect, it } from "vitest";

import { getActiveCompareLendingGraphSources } from "../../src/registry/index.js";
import { lendingMarketSourceResultSchema } from "../../src/schemas/source-adapter.js";
import {
  fetchCompareLendingGraphSource,
  TIER_A_LENDING_METRICS_QUERY,
  TIER_A_LENDING_METRICS_QUERY_ID,
} from "../../src/sources/graph/index.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

interface RateRow {
  id: string;
  side: string;
  type: string;
  rate: unknown;
}

interface MarketRow {
  id: string;
  name: unknown;
  isActive: unknown;
  canBorrowFrom: unknown;
  canUseAsCollateral: unknown;
  totalValueLockedUSD: unknown;
  totalDepositBalanceUSD: unknown;
  totalBorrowBalanceUSD: unknown;
  inputToken: { id: string; symbol: string; decimals: number };
  rates: RateRow[];
}

interface LendingPayload {
  _meta: {
    block: { number: number; timestamp: number; hash: string };
    hasIndexingErrors: boolean;
    deployment: string;
  };
  lendingProtocols: Array<Record<string, unknown>>;
  markets: MarketRow[];
}

const BLOCK_HASH = "0xa39b13862e2eb5f1f904c19c2e88fb5d82f9ee9f5352fd9f108a18e69247fbb1";

/** Live capture from D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9 at block 49121431. */
function aavePayload(): LendingPayload {
  return {
    _meta: {
      block: { number: 49121431, timestamp: 1785032209, hash: BLOCK_HASH },
      hasIndexingErrors: false,
      deployment: "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
    },
    lendingProtocols: [
      {
        id: "0xe20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d",
        name: "Aave v3",
        slug: "aave-v3",
        schemaVersion: "3.1.0",
        methodologyVersion: "1.1.0",
        network: "BASE",
        type: "LENDING",
        lendingType: "POOLED",
      },
    ],
    markets: [
      {
        id: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
        name: "Aave Base USDC",
        isActive: true,
        canBorrowFrom: true,
        canUseAsCollateral: false,
        totalValueLockedUSD: "172445303.026266003336",
        totalDepositBalanceUSD: "172445303.026266003336",
        totalBorrowBalanceUSD: "152467572.25396482662232",
        inputToken: { id: USDC, symbol: "USDC", decimals: 6 },
        rates: [
          { id: "BORROWER-STABLE-0x4e65", side: "BORROWER", type: "STABLE", rate: "0" },
          {
            id: "BORROWER-VARIABLE-0x4e65",
            side: "BORROWER",
            type: "VARIABLE",
            rate: "4.4207374872837901",
          },
          {
            id: "LENDER-VARIABLE-0x4e65",
            side: "LENDER",
            type: "VARIABLE",
            rate: "3.5177249578887369",
          },
        ],
      },
    ],
  };
}

/** Live capture from 2u4mWUV4xS19ef1MbnxZHWLLMwdPxtVifH46JbonXwXP at block 49121431. */
function seamlessPayload(): LendingPayload {
  return {
    _meta: {
      block: { number: 49121431, timestamp: 1785032209, hash: BLOCK_HASH },
      hasIndexingErrors: false,
      deployment: "QmPSmTkJPSKLFn46YdgwMKV5K2c9a3pkWnzDCC4ccCLAXE",
    },
    lendingProtocols: [
      { id: "0x90c5055530c0465abb077fa016a3699a3f53ef99", slug: "seamless", network: "BASE" },
    ],
    markets: [
      {
        id: "0x53e240c0f985175da046a62f26d490d1e259036e",
        name: "Seamless USDC",
        isActive: false,
        canBorrowFrom: true,
        canUseAsCollateral: false,
        totalValueLockedUSD: "205400.2928784070077",
        totalDepositBalanceUSD: "205400.2928784070077",
        totalBorrowBalanceUSD: "24150.82687434733677",
        inputToken: { id: USDC, symbol: "USDC", decimals: 6 },
        rates: [
          { id: "BORROWER-STABLE-0x53e2", side: "BORROWER", type: "STABLE", rate: "8" },
          {
            id: "BORROWER-VARIABLE-0x53e2",
            side: "BORROWER",
            type: "VARIABLE",
            rate: "1.0452685606279676",
          },
          {
            id: "LENDER-VARIABLE-0x53e2",
            side: "LENDER",
            type: "VARIABLE",
            rate: "0.1106243693385229",
          },
        ],
      },
    ],
  };
}

/** Live capture from 33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg at block 49121432. */
function moonwellPayload(): LendingPayload {
  return {
    _meta: {
      block: {
        number: 49121432,
        timestamp: 1785032211,
        hash: "0xeaa3038aa8c4bf926ffef0ae5e1c5bbd37007b6b23d2da97918160de41a37ad1",
      },
      hasIndexingErrors: false,
      deployment: "QmeE6TgfRmK2iLAgCLBeXuxJQ2VXLFAeHVMTvmnECiFw7y",
    },
    lendingProtocols: [
      { id: "0xfbb21d0380bee3312b33c4353c8936a0f13ef26c", slug: "moonwell", network: "BASE" },
    ],
    markets: [
      {
        id: "0xedc817a28e8b93b03976fbd4a3ddbc9f7d176c22",
        name: "Moonwell USDC",
        isActive: true,
        canBorrowFrom: true,
        canUseAsCollateral: true,
        totalValueLockedUSD: "15066697.09797739573995",
        totalDepositBalanceUSD: "15066697.09797739573995",
        totalBorrowBalanceUSD: "13154949.96727053476238",
        inputToken: { id: USDC, symbol: "USDC", decimals: 6 },
        rates: [
          {
            id: "BORROWER-VARIABLE-0xedc8",
            side: "BORROWER",
            type: "VARIABLE",
            rate: "5.2386888310416",
          },
          {
            id: "LENDER-VARIABLE-0xedc8",
            side: "LENDER",
            type: "VARIABLE",
            rate: "4.1165790985584",
          },
        ],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respondWith(data: unknown): typeof fetch {
  return () => Promise.resolve(jsonResponse({ data }));
}

describe("fetchCompareLendingGraphSource", () => {
  const [aave, seamless, moonwell] = getActiveCompareLendingGraphSources();

  it("binds the shipped profile to three lending sources", () => {
    expect(aave?.source_id).toBe("messari-aave-v3-base");
    expect(seamless?.source_id).toBe("messari-seamless-base");
    expect(moonwell?.source_id).toBe("messari-moonwell-base");
  });

  it("maps the Aave live payload into an ok LendingMarketSourceResult", async () => {
    let observedUrl = "";
    let observedAuthorization = "";
    let observedBody = "";
    const fetchImpl: typeof fetch = (input, init) => {
      observedUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      observedBody = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(jsonResponse({ data: aavePayload() }));
    };

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "test-credential-must-not-leak",
      fetchImpl,
      nowSeconds: 1_785_032_214,
    });

    expect(lendingMarketSourceResultSchema.parse(result).status).toBe("ok");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }

    expect(result.source_id).toBe("messari-aave-v3-base");
    expect(result.source_type).toBe("standardized_subgraph");
    expect(result.protocol).toBe("aave-v3");
    expect(result.data.market_id).toBe("0x4e65fe4dba92790696d040ac24aa414708f5c0ab");
    expect(result.data.market_name).toBe("Aave Base USDC");
    // Messari standardized subgraphs return decimals as an Int, not a string.
    expect(result.data.input_token).toEqual({ address: USDC, symbol: "USDC", decimals: 6 });
    expect(result.data.is_active).toBe(true);
    expect(result.data.can_borrow_from).toBe(true);
    expect(result.data.can_use_as_collateral).toBe(false);
    expect(result.data.tvl_usd).toBe("172445303.026266003336");
    expect(result.data.total_deposit_balance_usd).toBe("172445303.026266003336");
    expect(result.data.total_borrow_balance_usd).toBe("152467572.25396482662232");
    expect(result.data.lender_variable_rate_percent).toBe("3.5177249578887369");
    expect(result.data.borrower_variable_rate_percent).toBe("4.4207374872837901");
    expect(result.data.borrower_stable_rate_percent).toBe("0");
    expect(result.freshness.indexed_block).toBe(49121431);
    expect(result.freshness.queried_at).toBe(1_785_032_214);
    expect(result.warnings).toEqual([]);
    expect(result.provenance).toEqual({
      deployment_or_view_id: "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
      schema_version: "3.1.0",
      methodology_version: "1.1.0",
      query_id: TIER_A_LENDING_METRICS_QUERY_ID,
    });

    expect(observedUrl).toContain("/subgraphs/id/D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9");
    expect(observedUrl).not.toContain("test-credential");
    expect(observedAuthorization).toBe("Bearer test-credential-must-not-leak");
    expect(observedBody).toContain(USDC);
    expect(JSON.stringify(result)).not.toContain("test-credential");
  });

  it("keeps the Seamless market and warns instead of dropping an inactive one", async () => {
    const result = await fetchCompareLendingGraphSource(seamless!, {
      apiKey: "key",
      fetchImpl: respondWith(seamlessPayload()),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.market_id).toBe("0x53e240c0f985175da046a62f26d490d1e259036e");
    expect(result.data.is_active).toBe(false);
    expect(result.data.borrower_stable_rate_percent).toBe("8");
    expect(result.warnings).toEqual([
      "messari-seamless-base market 0x53e240c0f985175da046a62f26d490d1e259036e is reported as inactive.",
    ]);
  });

  it("maps a Moonwell payload without a stable rate to null, not zero", async () => {
    const result = await fetchCompareLendingGraphSource(moonwell!, {
      apiKey: "key",
      fetchImpl: respondWith(moonwellPayload()),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.lender_variable_rate_percent).toBe("4.1165790985584");
    expect(result.data.borrower_variable_rate_percent).toBe("5.2386888310416");
    expect(result.data.borrower_stable_rate_percent).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("warns when the response reports indexing errors", async () => {
    const data = aavePayload();
    data._meta.hasIndexingErrors = true;

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("ok");
    expect(result.warnings).toContain("Graph _meta.hasIndexingErrors is true for this response.");
  });

  it("nulls an ambiguous rate rather than picking one of the duplicates", async () => {
    const data = aavePayload();
    data.markets[0]!.rates.push({
      id: "LENDER-VARIABLE-duplicate",
      side: "LENDER",
      type: "VARIABLE",
      rate: "9.9",
    });

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.lender_variable_rate_percent).toBeNull();
    expect(result.warnings[0]).toMatch(/2 LENDER\/VARIABLE rates/);
  });

  it("nulls a malformed rate and warns", async () => {
    const data = aavePayload();
    data.markets[0]!.rates[2]!.rate = -1;

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.data.lender_variable_rate_percent).toBeNull();
    expect(result.warnings[0]).toMatch(/failed decimal validation/);
  });

  it("returns unsupported with retained freshness on deployment mismatch", async () => {
    const data = aavePayload();
    data._meta.deployment = "QmWrongDeploymentHashxxxxxxxxxxxxxxxxxxxxxxxxx";

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.provenance.deployment_or_view_id).toBe(data._meta.deployment);
    expect(result.warnings[0]).toMatch(/deployment mismatch/i);
  });

  it("returns unsupported when the deployment self-reports another network", async () => {
    // The failure mode that kept Compound v3 out of scope: a deployment
    // published for Base that indexes mainnet.
    const data = aavePayload();
    data.lendingProtocols[0]!.network = "MAINNET";

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.warnings[0]).toMatch(/self-reports network "MAINNET", expected "BASE"/);
  });

  it("returns unsupported when the protocol network is unreadable", async () => {
    const data = aavePayload();
    data.lendingProtocols = [];

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/missing a usable lendingProtocols.network/);
  });

  it("returns unsupported when no market matches the locked market token", async () => {
    const data = aavePayload();
    data.markets[0]!.inputToken = {
      id: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
    };

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.freshness).not.toBeNull();
    expect(result.warnings[0]).toContain(USDC);
  });

  it("returns unsupported rather than choosing between duplicate markets", async () => {
    const data = aavePayload();
    data.markets.push({
      ...data.markets[0]!,
      id: "0x1111111111111111111111111111111111111111",
    });

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/reported 2 markets/);
  });

  it("returns unsupported when a market flag is not a boolean", async () => {
    const data = aavePayload();
    data.markets[0]!.isActive = "true";

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.warnings[0]).toMatch(/failed shape validation/);
  });

  it("returns unsupported when a USD balance is not a decimal string", async () => {
    const data = aavePayload();
    data.markets[0]!.totalValueLockedUSD = 172445303.02;

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: respondWith(data),
      nowSeconds: 1_785_032_214,
    });

    expect(result.status).toBe("unsupported");
    expect(result.warnings[0]).toMatch(/failed shape validation/);
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

    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.status).toBe("timeout");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
    expect(result.warnings[0]).toMatch(/timeout/i);
  });

  it("returns error on GraphQL errors without inventing market data", async () => {
    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ errors: [{ message: "boom" }], data: null })),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.freshness).toBeNull();
  });

  it("returns error on HTTP non-2xx gateway responses", async () => {
    const result = await fetchCompareLendingGraphSource(aave!, {
      apiKey: "key",
      fetchImpl: () => Promise.resolve(jsonResponse({ message: "nope" }, 503)),
    });

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    expect(result.warnings[0]).toMatch(/HTTP 503/);
  });

  it("returns error when GRAPH_API_KEY is missing", async () => {
    let called = false;
    const result = await fetchCompareLendingGraphSource(aave!, {
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
    const result = await fetchCompareLendingGraphSource(
      { ...aave!, query_id: "other-query-v1" },
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

  it("filters markets by input token so a protocol's other markets cannot be selected", () => {
    expect(TIER_A_LENDING_METRICS_QUERY).toContain("where: { inputToken: $token }");
  });
});
