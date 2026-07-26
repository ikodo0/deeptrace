import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import {
  COMPARE_LENDING_MARKETS_TOOL_NAME,
  COMPARE_POOLS_TOOL_NAME,
  FIND_LARGE_SWAPS_TOOL_NAME,
  RESEARCH_WALLET_TOOL_NAME,
} from "../../src/mcp/server.js";
import { startMcpServer } from "../../src/mcp/lifecycle.js";
import { M0_CORE_POLICY } from "../../src/policy/index.js";
import { findLargeSwapsResponseSchema } from "../../src/schemas/index.js";
import { LSS_SCOPE } from "../../src/scope/index.js";
import type { LargeSwapSourceGateway, LargeSwapSourceResult } from "../../src/tools/index.js";
import { createFixtureComparePoolsSources, executeFindLargeSwaps } from "../../src/tools/index.js";
import { usdcToWethSwapFixture, wethToUsdcSwapFixture } from "../fixtures/large-swaps.js";
import { lockedLargeSwapsRequest } from "../fixtures/large-swaps-request.js";

const PROVENANCE = {
  source_id: LSS_SCOPE.source.sourceId,
  source_type: "nuthatch_view",
  protocol: LSS_SCOPE.protocol,
  chain_id: LSS_SCOPE.chainId,
  deployment_or_view_id: "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25",
  schema_version: null,
  methodology_version: LSS_SCOPE.source.methodologyVersion,
  query_id: LSS_SCOPE.source.queryId,
} as const;

const FRESHNESS = {
  source_id: LSS_SCOPE.source.sourceId,
  status: "fresh",
  indexed_block: 20_000_100,
  indexed_block_timestamp: 1_749_999_990,
  indexed_block_hash: `0x${"a".repeat(64)}`,
  queried_at: 1_750_000_000,
  lag_seconds: 10,
} as const;

const LSS_WETH_TO_USDC = {
  ...wethToUsdcSwapFixture,
  source_id: LSS_SCOPE.source.sourceId,
};
const LSS_USDC_TO_WETH = {
  ...usdcToWethSwapFixture,
  source_id: LSS_SCOPE.source.sourceId,
};

function source(result: LargeSwapSourceResult) {
  const fetchCandidatesSpy = vi.fn(() => Promise.resolve(result));
  return {
    provenance: PROVENANCE,
    fetchCandidates: fetchCandidatesSpy,
    fetchCandidatesSpy,
  } satisfies LargeSwapSourceGateway & {
    readonly fetchCandidatesSpy: typeof fetchCandidatesSpy;
  };
}

function success(events = [LSS_WETH_TO_USDC, LSS_USDC_TO_WETH]) {
  return source({
    status: "ok",
    events,
    indexedHead: 20_000_100,
    freshness: FRESHNESS,
    provenance: PROVENANCE,
    warnings: [],
  });
}

describe("executeFindLargeSwaps", () => {
  it("settles a complete exact-threshold page", async () => {
    const response = await executeFindLargeSwaps(lockedLargeSwapsRequest, success());

    expect(findLargeSwapsResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("complete");
    expect(response.data?.swaps).toEqual([LSS_WETH_TO_USDC]);
    expect(response.coverage).toEqual({
      requested_sources: 1,
      successful_sources: 1,
    });
  });

  it("settles a valid zero-match page as complete", async () => {
    const response = await executeFindLargeSwaps(
      { ...lockedLargeSwapsRequest, min_amount: "1000000" },
      success([]),
    );

    expect(response).toMatchObject({
      status: "complete",
      data: { swaps: [] },
      coverage: { requested_sources: 1, successful_sources: 1 },
      pagination: { returned: 0, has_more: false, next_cursor: null },
    });
  });

  it("shortens a maximum-limit page without exceeding the response budget or omitting events", async () => {
    const events = Array.from({ length: 101 }, (_, logIndex) => ({
      ...LSS_WETH_TO_USDC,
      transaction_hash: `0x${logIndex.toString(16).padStart(64, "0")}`,
      log_index: logIndex,
      amount_in: "9".repeat(60),
      amount_out: "8".repeat(60),
      amount_in_raw: "9".repeat(78),
      amount_out_raw: `-${"8".repeat(78)}`,
    }));
    const gateway = success(events);
    const request = { ...lockedLargeSwapsRequest, limit: 100 } as const;

    const first = await executeFindLargeSwaps(request, gateway);
    expect(first.status).toBe("complete");
    expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThanOrEqual(
      M0_CORE_POLICY.gateway.maximumResponseBytes,
    );
    expect(first.pagination).toMatchObject({
      limit: 100,
      has_more: true,
    });
    expect(first.pagination.returned).toBeLessThan(100);
    expect(first.warnings).toContain(
      "Page was shortened below the requested limit to preserve the response-size budget.",
    );

    const second = await executeFindLargeSwaps(
      { ...request, cursor: first.pagination.next_cursor },
      gateway,
    );
    const swaps = [
      ...(first.status === "complete" ? first.data.swaps : []),
      ...(second.status === "complete" ? second.data.swaps : []),
    ];
    expect(swaps).toHaveLength(events.length);
    expect(
      new Set(swaps.map(({ transaction_hash, log_index }) => `${transaction_hash}:${log_index}`))
        .size,
    ).toBe(events.length);
  });

  it("settles the sole source failing as failed and contains thrown adapters", async () => {
    const unavailable = source({
      status: "error",
      events: null,
      indexedHead: null,
      freshness: { source_id: LSS_SCOPE.source.sourceId, status: "unavailable" },
      provenance: PROVENANCE,
      warnings: ["fixture source unavailable"],
    });
    await expect(
      executeFindLargeSwaps(lockedLargeSwapsRequest, unavailable),
    ).resolves.toMatchObject({
      status: "failed",
      data: null,
      warnings: ["fixture source unavailable"],
    });

    const throwing: LargeSwapSourceGateway = {
      provenance: PROVENANCE,
      fetchCandidates: vi.fn(() => Promise.reject(new Error("secret adapter detail"))),
    };
    const contained = await executeFindLargeSwaps(lockedLargeSwapsRequest, throwing);
    expect(contained.status).toBe("failed");
    expect(JSON.stringify(contained)).not.toContain("secret adapter detail");
  });

  it("rejects invalid requests before invoking the source", async () => {
    const gateway = success();
    await expect(
      executeFindLargeSwaps(
        { ...lockedLargeSwapsRequest, min_amount: "1; DROP TABLE pool__swap" },
        gateway,
      ),
    ).rejects.toThrow();
    expect(gateway.fetchCandidatesSpy).not.toHaveBeenCalled();
  });
});

describe("find_large_swaps MCP tool", () => {
  async function withClient(gateway = success()) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpServer(serverTransport, {
      sources: createFixtureComparePoolsSources({ graphResults: [] }),
      largeSwapSource: gateway,
      gatewayConfig: {
        rateLimitMaxRequests: 30,
        rateLimitWindowMs: 60_000,
        sourceTimeoutMs: 5_000,
      },
    });
    const client = new Client({ name: "lss-test-client", version: "0.1.0" });
    await client.connect(clientTransport);
    return { client, runtime };
  }

  it("lists all implemented tools with the LSS contract", async () => {
    const { client, runtime } = await withClient();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        COMPARE_POOLS_TOOL_NAME,
        COMPARE_LENDING_MARKETS_TOOL_NAME,
        FIND_LARGE_SWAPS_TOOL_NAME,
        RESEARCH_WALLET_TOOL_NAME,
      ]);
      const tool = listed.tools[2];
      expect(tool?.title).toBe("Find large Base WETH/USDC swaps");
      expect(tool?.description).toContain("no USD conversion");
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const inputProperties = tool?.inputSchema.properties as
        Record<string, { description?: string }> | undefined;
      expect(inputProperties?.chain_id?.description).toContain("8453");
      expect(inputProperties?.min_amount?.description).toContain("never USD");
      expect(inputProperties?.cursor?.description).toContain("next_cursor");
      expect(tool?.outputSchema).toMatchObject({ type: "object" });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("returns structured complete results and rejects arbitrary SQL fields", async () => {
    const gateway = success();
    const { client, runtime } = await withClient(gateway);
    try {
      const result = await client.callTool({
        name: FIND_LARGE_SWAPS_TOOL_NAME,
        arguments: lockedLargeSwapsRequest,
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        status: "complete",
        data: { swaps: [LSS_WETH_TO_USDC] },
      });

      const rejected = await client.callTool({
        name: FIND_LARGE_SWAPS_TOOL_NAME,
        arguments: { ...lockedLargeSwapsRequest, sql: "SELECT * FROM pool__swap" },
      });
      expect(rejected.isError).toBe(true);
      expect(gateway.fetchCandidatesSpy).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
