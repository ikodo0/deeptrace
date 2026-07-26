import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { startMcpServer } from "../../src/mcp/lifecycle.js";
import {
  COMPARE_LENDING_MARKETS_TOOL_NAME,
  COMPARE_POOLS_TOOL_NAME,
  FIND_LARGE_SWAPS_TOOL_NAME,
  createMcpServer,
  serverInfo,
} from "../../src/mcp/server.js";
import { M0_COMPARE_LENDING_SCOPE } from "../../src/scope/index.js";
import {
  createFixtureCompareLendingSources,
  createFixtureComparePoolsSources,
} from "../../src/tools/index.js";
import { completeLendingScenario } from "../fixtures/lending-sources.js";

const lockedLendingRequest = {
  chain_id: M0_COMPARE_LENDING_SCOPE.chainId,
  market_token: M0_COMPARE_LENDING_SCOPE.marketToken.address,
} as const;

async function withClient(
  lendingSources = createFixtureCompareLendingSources({
    lendingResults: completeLendingScenario,
  }),
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const runtime = await startMcpServer(serverTransport, {
    sources: createFixtureComparePoolsSources({ graphResults: [] }),
    lendingSources,
    gatewayConfig: {
      rateLimitMaxRequests: 30,
      rateLimitWindowMs: 60_000,
      sourceTimeoutMs: 5_000,
    },
  });
  const client = new Client({ name: "deeptrace-test-client", version: "0.1.0" });
  await client.connect(clientTransport);
  return { client, runtime };
}

describe("MCP server foundation", () => {
  it("creates the configured DeepTrace server", () => {
    expect(
      createMcpServer({
        sources: createFixtureComparePoolsSources({ graphResults: [] }),
        lendingSources: createFixtureCompareLendingSources({ lendingResults: [] }),
      }),
    ).toBeDefined();
    expect(serverInfo).toEqual({
      name: "deeptrace",
      version: "0.1.0",
    });
  });

  it("exposes both read-only comparison tools", async () => {
    const { client, runtime } = await withClient();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        [
          COMPARE_LENDING_MARKETS_TOOL_NAME,
          COMPARE_POOLS_TOOL_NAME,
          FIND_LARGE_SWAPS_TOOL_NAME,
        ].sort(),
      );
      for (const tool of listed.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(true);
        expect(tool.annotations?.openWorldHint).toBe(false);
      }
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});

describe("compare_lending_markets MCP tool", () => {
  it("returns a ranked lending envelope from the injected gateway", async () => {
    const onLendingFetch = vi.fn();
    const { client, runtime } = await withClient(
      createFixtureCompareLendingSources({
        lendingResults: completeLendingScenario,
        onLendingFetch,
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_LENDING_MARKETS_TOOL_NAME,
        arguments: lockedLendingRequest,
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(text).toBeTypeOf("string");
      const body = JSON.parse(text!) as {
        status: string;
        coverage: { requested_sources: number; successful_sources: number };
        data: { rate_basis: string; markets: Array<{ protocol: string }> } | null;
      };
      expect(body.status).toBe("complete");
      expect(body.coverage).toEqual({ requested_sources: 3, successful_sources: 3 });
      expect(body.data?.rate_basis).toBe("percent_apy");
      expect(body.data?.markets[0]?.protocol).toBe("aave-v3");
      expect(onLendingFetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects an out-of-scope market token before calling source adapters", async () => {
    const onLendingFetch = vi.fn();
    const { client, runtime } = await withClient(
      createFixtureCompareLendingSources({
        lendingResults: completeLendingScenario,
        onLendingFetch,
      }),
    );

    try {
      const result = await client.callTool({
        name: COMPARE_LENDING_MARKETS_TOOL_NAME,
        arguments: {
          ...lockedLendingRequest,
          market_token: "0x4200000000000000000000000000000000000006",
        },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Input validation error|Invalid arguments/i,
      );
      expect(onLendingFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
