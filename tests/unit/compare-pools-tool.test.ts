import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { FixedWindowRateLimiter } from "../../src/gateway/index.js";
import { COMPARE_POOLS_TOOL_NAME } from "../../src/mcp/server.js";
import { startMcpServer } from "../../src/mcp/lifecycle.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import {
  ComparePoolsRequestError,
  createFixtureComparePoolsSources,
  createLiveComparePoolsSources,
  executeComparePools,
} from "../../src/tools/index.js";
import { lockedComparePoolsRequest } from "../fixtures/compare-pools-request.js";
import { graphPoolA, graphPoolB, graphPoolCTimeout } from "../fixtures/sources/index.js";

describe("executeComparePools", () => {
  it("rejects invalid requests before calling source adapters", async () => {
    const onGraphFetch = vi.fn();
    const sources = createFixtureComparePoolsSources({
      graphResults: [graphPoolA, graphPoolB],
      onGraphFetch,
    });

    await expect(
      executeComparePools(
        {
          ...lockedComparePoolsRequest,
          token1: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
        } as typeof lockedComparePoolsRequest,
        sources,
      ),
    ).rejects.toBeInstanceOf(ComparePoolsRequestError);
    expect(onGraphFetch).not.toHaveBeenCalled();
  });

  it("starts Graph and Nuthatch without waiting for either source", async () => {
    let releaseGraph: ((results: typeof graphResults) => void) | undefined;
    const graphResults = [graphPoolA, graphPoolB] as const;
    const graphPending = new Promise<typeof graphResults>((resolve) => {
      releaseGraph = resolve;
    });
    const onGraphFetch = vi.fn(() => graphPending);
    const onNuthatchFetch = vi.fn(() => Promise.resolve(null));

    const execution = executeComparePools(lockedComparePoolsRequest, {
      fetchGraphResults: onGraphFetch,
      fetchNuthatchResult: onNuthatchFetch,
    });

    expect(onGraphFetch).toHaveBeenCalledTimes(1);
    expect(onNuthatchFetch).toHaveBeenCalledTimes(1);
    releaseGraph?.(graphResults);
    await expect(execution).resolves.toMatchObject({
      coverage: { successful_deployments: 2 },
    });
  });
});

describe("createLiveComparePoolsSources", () => {
  it("forwards gateway sourceTimeoutMs to Graph fetches", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const sources = createLiveComparePoolsSources({
      apiKey: "key",
      timeoutMs: 20,
      fetchImpl,
    });
    const results = await sources.fetchGraphResults(lockedComparePoolsRequest);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.status === "timeout")).toBe(true);
  });
});

describe("compare_pools MCP tool", () => {
  async function withClient(
    sources = createFixtureComparePoolsSources({
      graphResults: [graphPoolA, graphPoolB],
    }),
    rateLimiter?: FixedWindowRateLimiter,
  ) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpServer(serverTransport, {
      sources,
      ...(rateLimiter !== undefined ? { rateLimiter } : {}),
      gatewayConfig: {
        rateLimitMaxRequests: 30,
        rateLimitWindowMs: 60_000,
        sourceTimeoutMs: 5_000,
      },
    });
    const client = new Client({
      name: "deeptrace-test-client",
      version: "0.1.0",
    });
    await client.connect(clientTransport);
    return { client, runtime };
  }

  it("advertises compare_pools as a read-only tool", async () => {
    const { client, runtime } = await withClient();
    try {
      const listed = await client.listTools();
      const comparePools = listed.tools.find((tool) => tool.name === COMPARE_POOLS_TOOL_NAME);
      expect(comparePools).toBeDefined();
      expect(comparePools?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("returns ranked fixture pools without inventing Nuthatch", async () => {
    const onGraphFetch = vi.fn();
    const { client, runtime } = await withClient(
      createFixtureComparePoolsSources({
        graphResults: [graphPoolA, graphPoolB],
        onGraphFetch,
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: lockedComparePoolsRequest,
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toBeTypeOf("string");
      const body = JSON.parse(text!) as {
        status: string;
        coverage: { nuthatch_available: boolean; successful_deployments: number };
        data: { pools: Array<{ source_ids: string[] }> } | null;
      };
      expect(body.status).toBe("partial");
      expect(body.coverage.nuthatch_available).toBe(false);
      expect(body.coverage.successful_deployments).toBe(2);
      expect(body.data?.pools[0]?.source_ids).toEqual([graphPoolA.source_id]);
      expect(onGraphFetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects unsupported pair inputs before calling source adapters", async () => {
    const onGraphFetch = vi.fn();
    const { client, runtime } = await withClient(
      createFixtureComparePoolsSources({
        graphResults: [graphPoolA, graphPoolB],
        onGraphFetch,
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: {
          ...lockedComparePoolsRequest,
          token1: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
        },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Input validation error|Invalid arguments/i,
      );
      expect(onGraphFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects unknown request fields before calling source adapters", async () => {
    const onGraphFetch = vi.fn();
    const { client, runtime } = await withClient(
      createFixtureComparePoolsSources({
        graphResults: [graphPoolA, graphPoolB],
        onGraphFetch,
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: {
          ...lockedComparePoolsRequest,
          subgraph_id: "must-not-leak",
        },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Input validation error|Invalid arguments|unrecognized key/i,
      );
      expect(onGraphFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("does not call adapters when rate limited", async () => {
    const onGraphFetch = vi.fn();
    const rateLimiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      clock: (() => {
        const now = 1_000;
        return () => now;
      })(),
    });
    const sources = createFixtureComparePoolsSources({
      graphResults: [graphPoolA, graphPoolB],
      onGraphFetch,
    });
    const { client, runtime } = await withClient(sources, rateLimiter);

    try {
      const first = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: lockedComparePoolsRequest,
      });
      expect(first.isError).toBeFalsy();
      expect(onGraphFetch).toHaveBeenCalledTimes(1);

      const second = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: lockedComparePoolsRequest,
      });
      expect(second.isError).toBe(true);
      expect((second.content as Array<{ text: string }>)[0]?.text).toMatch(/Rate limit/i);
      expect(onGraphFetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("preserves a successful Graph pool when a sibling times out", async () => {
    const { client, runtime } = await withClient(
      createFixtureComparePoolsSources({
        graphResults: [graphPoolA, graphPoolCTimeout],
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_POOLS_TOOL_NAME,
        arguments: {
          chain_id: M0_COMPARE_POOLS_SCOPE.chainId,
          token0: M0_COMPARE_POOLS_SCOPE.token0.address,
          token1: M0_COMPARE_POOLS_SCOPE.token1.address,
          ranked_by: "volume_usd",
        },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      const body = JSON.parse(text!) as {
        status: string;
        coverage: { successful_deployments: number };
        data: { pools: Array<{ source_ids: string[] }> } | null;
      };
      expect(body.status).toBe("partial");
      expect(body.coverage.successful_deployments).toBe(1);
      expect(body.data?.pools[0]?.source_ids).toEqual([graphPoolA.source_id]);
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
