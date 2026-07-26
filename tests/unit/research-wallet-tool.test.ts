import { describe, expect, it, vi } from "vitest";

import type {
  DeFiPosition,
  ResultFreshness,
  ResultProvenance,
  WalletActivity,
} from "../../src/schemas/index.js";
import { WALLET_RESEARCH_SCOPE } from "../../src/scope/wallet-research.js";
import {
  executeResearchWallet,
  WalletResearchQueryError,
  type WalletResearchSourceGateway,
} from "../../src/tools/index.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";
const OTHER = "0x1111111111111111111111111111111111111111";
const OTHER_TWO = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;

const graphProvenance: ResultProvenance = {
  source_id: WALLET_RESEARCH_SCOPE.graph.sourceId,
  source_type: "standardized_subgraph",
  protocol: WALLET_RESEARCH_SCOPE.graph.protocol,
  chain_id: 8453,
  deployment_or_view_id: WALLET_RESEARCH_SCOPE.graph.deploymentId,
  schema_version: "3.1.0",
  methodology_version: "1.1.0",
  query_id: WALLET_RESEARCH_SCOPE.graph.queryId,
};

const nuthatchProvenance: ResultProvenance = {
  source_id: WALLET_RESEARCH_SCOPE.nuthatch.sourceId,
  source_type: "nuthatch_view",
  protocol: WALLET_RESEARCH_SCOPE.nuthatch.protocol,
  chain_id: 8453,
  deployment_or_view_id: `0x${"12".repeat(32)}`,
  schema_version: null,
  methodology_version: WALLET_RESEARCH_SCOPE.nuthatch.methodologyVersion,
  query_id: WALLET_RESEARCH_SCOPE.nuthatch.queryId,
};

function freshness(source_id: string): ResultFreshness {
  return {
    source_id,
    status: "fresh",
    indexed_block: 100,
    indexed_block_timestamp: 990,
    indexed_block_hash: BLOCK_HASH,
    queried_at: 1_000,
    lag_seconds: 10,
  };
}

const position: DeFiPosition = {
  id: `${WALLET}-weth-collateral`,
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
      raw_amount: "2000000000000000",
      normalized_amount: "0.002",
      usd_price: null,
      usd_value: "3.84",
    },
  ],
  valuation: { usd_value: "3.84" },
  observed_at: { block_number: 100, timestamp: 990 },
  source_ids: [WALLET_RESEARCH_SCOPE.graph.sourceId],
};

function activity(
  transaction_hash = HASH,
  block_number = 100,
  log_index = 1,
  counterparty = OTHER,
): WalletActivity {
  return {
    id: `8453:${transaction_hash}:${String(log_index)}`,
    chain_id: 8453,
    wallet_address: WALLET,
    protocol: "uniswap-v3",
    activity_type: "swap_received",
    transaction_hash,
    log_index,
    block_number,
    timestamp: 990,
    counterparty,
    assets: [
      {
        token_address: WALLET_RESEARCH_SCOPE.tokens.weth.address,
        symbol: "WETH",
        decimals: 18,
        role: "swap_in",
        raw_amount: "1000000000000000",
        normalized_amount: "0.001",
        usd_price: null,
        usd_value: null,
      },
      {
        token_address: WALLET_RESEARCH_SCOPE.tokens.usdc.address,
        symbol: "USDC",
        decimals: 6,
        role: "swap_out",
        raw_amount: "2000000",
        normalized_amount: "2",
        usd_price: null,
        usd_value: null,
      },
    ],
    source_id: WALLET_RESEARCH_SCOPE.nuthatch.sourceId,
  };
}

function sources(
  activities: readonly WalletActivity[] = [activity()],
): WalletResearchSourceGateway {
  return {
    graphProvenance,
    nuthatchProvenance,
    fetchPositions: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        positions: [position],
        freshness: freshness(graphProvenance.source_id),
        provenance: graphProvenance,
        warnings: [],
      }),
    ),
    fetchActivity: vi.fn(() =>
      Promise.resolve({
        status: "ok" as const,
        activities,
        indexedHead: 100,
        freshness: freshness(nuthatchProvenance.source_id),
        provenance: nuthatchProvenance,
        warnings: [],
      }),
    ),
  };
}

describe("research_wallet", () => {
  it("composes load-bearing Graph and Nuthatch facts", async () => {
    const result = await executeResearchWallet({ chain_id: 8453, address: WALLET }, sources());

    expect(result.status).toBe("complete");
    expect(result.data).toMatchObject({
      wallet_address: WALLET,
      activity: [{ source_id: WALLET_RESEARCH_SCOPE.nuthatch.sourceId }],
      positions: [{ source_ids: [WALLET_RESEARCH_SCOPE.graph.sourceId] }],
      counterparties: [{ address: OTHER, interaction_count: 1 }],
      observable_flows: [{ direction: "inflow", normalized_amount: "2" }],
    });
    expect(result.coverage).toMatchObject({
      requested_sources: 2,
      successful_sources: 2,
    });
  });

  it("preserves Graph positions when Nuthatch is unavailable", async () => {
    const gateway = sources();
    gateway.fetchActivity = vi.fn(() =>
      Promise.resolve({
        status: "error" as const,
        activities: null,
        indexedHead: null,
        freshness: {
          source_id: nuthatchProvenance.source_id,
          status: "unavailable" as const,
        },
        provenance: nuthatchProvenance,
        warnings: ["Nuthatch is unavailable."],
      }),
    );

    const result = await executeResearchWallet({ chain_id: 8453, address: WALLET }, gateway);

    expect(result.status).toBe("partial");
    expect(result.data?.positions).toEqual([position]);
    expect(result.data?.activity).toEqual([]);
    expect(result.warnings).toContain("Nuthatch is unavailable.");
  });

  it("preserves Nuthatch activity when Graph is unavailable", async () => {
    const gateway = sources();
    gateway.fetchPositions = vi.fn(() =>
      Promise.resolve({
        status: "error" as const,
        positions: null,
        freshness: {
          source_id: graphProvenance.source_id,
          status: "unavailable" as const,
        },
        provenance: graphProvenance,
        warnings: ["Graph is unavailable."],
      }),
    );

    const result = await executeResearchWallet({ chain_id: 8453, address: WALLET }, gateway);
    expect(result.status).toBe("partial");
    expect(result.data?.activity).toHaveLength(1);
    expect(result.data?.positions).toEqual([]);
  });

  it("fails only when neither source returns usable facts", async () => {
    const gateway = sources();
    gateway.fetchPositions = vi.fn(() =>
      Promise.resolve({
        status: "error" as const,
        positions: null,
        freshness: {
          source_id: graphProvenance.source_id,
          status: "unavailable" as const,
        },
        provenance: graphProvenance,
        warnings: ["Graph is unavailable."],
      }),
    );
    gateway.fetchActivity = vi.fn(() =>
      Promise.resolve({
        status: "error" as const,
        activities: null,
        indexedHead: null,
        freshness: {
          source_id: nuthatchProvenance.source_id,
          status: "unavailable" as const,
        },
        provenance: nuthatchProvenance,
        warnings: ["Nuthatch is unavailable."],
      }),
    );

    const result = await executeResearchWallet({ chain_id: 8453, address: WALLET }, gateway);
    expect(result).toMatchObject({
      status: "failed",
      data: null,
      coverage: { successful_sources: 0 },
    });
  });

  it("returns stable wallet-scoped cursor pages", async () => {
    const secondHash = `0x${"ef".repeat(32)}`;
    const gateway = sources([activity(HASH, 100, 1), activity(secondHash, 99, 2, OTHER_TWO)]);
    const first = await executeResearchWallet(
      { chain_id: 8453, address: WALLET, limit: 1 },
      gateway,
    );
    expect(first.pagination).toMatchObject({ returned: 1, has_more: true });
    expect(first.data?.counterparties).toHaveLength(2);
    expect(first.data?.observable_flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "inflow", normalized_amount: "4" }),
      ]),
    );

    const second = await executeResearchWallet(
      {
        chain_id: 8453,
        address: WALLET,
        limit: 1,
        cursor: first.pagination.next_cursor,
      },
      gateway,
    );
    expect(second.data?.activity[0]?.transaction_hash).toBe(secondHash);
    expect(second.data?.counterparties).toEqual(first.data?.counterparties);
    expect(second.data?.observable_flows).toEqual(first.data?.observable_flows);
    expect(second.pagination).toMatchObject({ returned: 1, has_more: false });
  });

  it("can be complete when load-bearing source sections are not returned directly", async () => {
    const result = await executeResearchWallet(
      {
        chain_id: 8453,
        address: WALLET,
        sections: ["observed_assets", "protocol_usage"],
      },
      sources(),
    );
    expect(result.status).toBe("complete");
    expect(result.data?.activity).toEqual([]);
    expect(result.data?.positions).toEqual([]);
    expect(result.data?.observed_assets.length).toBeGreaterThan(0);
  });

  it("rejects non-lowercase public addresses before source calls", async () => {
    const gateway = sources();
    const fetchPositions = vi.spyOn(gateway, "fetchPositions");
    const fetchActivity = vi.spyOn(gateway, "fetchActivity");
    await expect(
      executeResearchWallet({ chain_id: 8453, address: WALLET.toUpperCase() }, gateway),
    ).rejects.toBeInstanceOf(WalletResearchQueryError);
    expect(fetchPositions).not.toHaveBeenCalled();
    expect(fetchActivity).not.toHaveBeenCalled();
  });
});
