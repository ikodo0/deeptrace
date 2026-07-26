import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { RESEARCH_WALLET_TOOL_NAME } from "../../src/mcp/server.js";
import { startMcpServer } from "../../src/mcp/lifecycle.js";
import type {
  DeFiPosition,
  ResultFreshness,
  ResultProvenance,
  WalletActivity,
} from "../../src/schemas/index.js";
import { WALLET_RESEARCH_SCOPE } from "../../src/scope/wallet-research.js";
import {
  createFixtureComparePoolsSources,
  type WalletResearchSourceGateway,
} from "../../src/tools/index.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function sourceQuality(
  source_id: string,
  source_type: "standardized_subgraph" | "nuthatch_view",
  protocol: string,
  deployment_or_view_id: string,
  query_id: string,
): { freshness: ResultFreshness; provenance: ResultProvenance } {
  return {
    freshness: {
      source_id,
      status: "fresh",
      indexed_block: 100,
      indexed_block_timestamp: 990,
      indexed_block_hash: BLOCK_HASH,
      queried_at: 1_000,
      lag_seconds: 10,
    },
    provenance: {
      source_id,
      source_type,
      protocol,
      chain_id: 8453,
      deployment_or_view_id,
      schema_version: source_type === "nuthatch_view" ? null : "3.1.0",
      methodology_version:
        source_type === "nuthatch_view"
          ? WALLET_RESEARCH_SCOPE.nuthatch.methodologyVersion
          : "1.1.0",
      query_id,
    },
  };
}

describe("research_wallet MCP tool", () => {
  it("returns structured content and rejects invalid wallet input", async () => {
    const graph = sourceQuality(
      WALLET_RESEARCH_SCOPE.graph.sourceId,
      "standardized_subgraph",
      "aave-v3",
      WALLET_RESEARCH_SCOPE.graph.deploymentId,
      WALLET_RESEARCH_SCOPE.graph.queryId,
    );
    const nuthatch = sourceQuality(
      WALLET_RESEARCH_SCOPE.nuthatch.sourceId,
      "nuthatch_view",
      "uniswap-v3",
      `0x${"12".repeat(32)}`,
      WALLET_RESEARCH_SCOPE.nuthatch.queryId,
    );
    const position = {
      id: "position-1",
      chain_id: 8453,
      protocol: "aave-v3",
      position_type: "lending_collateral",
      container: {
        address: "0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7",
        name: "Aave Base WETH",
      },
      assets: [
        {
          token_address: WALLET_RESEARCH_SCOPE.tokens.weth.address,
          symbol: "WETH",
          decimals: 18,
          role: "collateral",
          raw_amount: "1",
          normalized_amount: "0.000000000000000001",
          usd_price: null,
          usd_value: null,
        },
      ],
      valuation: { usd_value: null },
      observed_at: { block_number: 100, timestamp: 990 },
      source_ids: [graph.provenance.source_id],
    } satisfies DeFiPosition;
    const activity = {
      id: `8453:0x${"34".repeat(32)}:1`,
      chain_id: 8453,
      wallet_address: WALLET,
      protocol: "uniswap-v3",
      activity_type: "swap_received",
      transaction_hash: `0x${"34".repeat(32)}`,
      log_index: 1,
      block_number: 100,
      timestamp: 990,
      counterparty: "0x1111111111111111111111111111111111111111",
      assets: [
        {
          token_address: WALLET_RESEARCH_SCOPE.tokens.weth.address,
          symbol: "WETH",
          decimals: 18,
          role: "swap_in",
          raw_amount: "1",
          normalized_amount: "0.000000000000000001",
          usd_price: null,
          usd_value: null,
        },
        {
          token_address: WALLET_RESEARCH_SCOPE.tokens.usdc.address,
          symbol: "USDC",
          decimals: 6,
          role: "swap_out",
          raw_amount: "1",
          normalized_amount: "0.000001",
          usd_price: null,
          usd_value: null,
        },
      ],
      source_id: nuthatch.provenance.source_id,
    } satisfies WalletActivity;
    const walletSources: WalletResearchSourceGateway = {
      graphProvenance: graph.provenance,
      nuthatchProvenance: nuthatch.provenance,
      fetchPositions: () =>
        Promise.resolve({
          status: "ok",
          positions: [position],
          ...graph,
          warnings: [],
        }),
      fetchActivity: () =>
        Promise.resolve({
          status: "ok",
          activities: [activity],
          indexedHead: 100,
          ...nuthatch,
          warnings: [],
        }),
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const runtime = await startMcpServer(serverTransport, {
      sources: createFixtureComparePoolsSources({ graphResults: [] }),
      walletSources,
    });
    const client = new Client({ name: "wallet-test", version: "0.1.0" });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: RESEARCH_WALLET_TOOL_NAME,
        arguments: { chain_id: 8453, address: WALLET },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        status: "complete",
        data: { wallet_address: WALLET },
      });

      const invalid = await client.callTool({
        name: RESEARCH_WALLET_TOOL_NAME,
        arguments: { chain_id: 8453, address: WALLET.toUpperCase() },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
