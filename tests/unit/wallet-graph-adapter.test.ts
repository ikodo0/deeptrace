import { describe, expect, it, vi } from "vitest";

import { getSourceById } from "../../src/registry/index.js";
import type { GraphSourceRegistryRecord } from "../../src/registry/types.js";
import { researchWalletRequestSchema } from "../../src/schemas/index.js";
import { WALLET_RESEARCH_SCOPE } from "../../src/scope/wallet-research.js";
import { fetchWalletGraphPositions } from "../../src/sources/graph/wallet-adapter.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";
const request = researchWalletRequestSchema.parse({ chain_id: 8453, address: WALLET });

function record(): GraphSourceRegistryRecord {
  const source = getSourceById(WALLET_RESEARCH_SCOPE.graph.sourceId);
  if (source === undefined || source.source_type === "nuthatch_view") {
    throw new Error("Missing wallet Graph fixture record");
  }
  return source;
}

describe("wallet Graph adapter", () => {
  it("normalizes a verified account position and Graph snapshot valuation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              _meta: {
                block: {
                  number: 100,
                  timestamp: 990,
                  hash: `0x${"ab".repeat(32)}`,
                },
                hasIndexingErrors: false,
                deployment: WALLET_RESEARCH_SCOPE.graph.deploymentId,
              },
              lendingProtocols: [
                {
                  schemaVersion: "3.1.0",
                  methodologyVersion: "1.1.0",
                  network: "BASE",
                },
              ],
              positions: [
                {
                  id: `${WALLET}-weth-collateral`,
                  account: { id: WALLET },
                  market: {
                    id: "0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7",
                    name: "Aave Base WETH",
                  },
                  asset: {
                    id: WALLET_RESEARCH_SCOPE.tokens.weth.address,
                    symbol: "WETH",
                    decimals: 18,
                  },
                  side: "COLLATERAL",
                  type: null,
                  isCollateral: true,
                  balance: "2000000000000000",
                  blockNumberOpened: "90",
                  timestampOpened: "900",
                  snapshots: [
                    {
                      balance: "2000000000000000",
                      balanceUSD: "3.84",
                      blockNumber: "100",
                      timestamp: "990",
                    },
                  ],
                },
                {
                  id: `${WALLET}-weth-supply`,
                  account: { id: WALLET },
                  market: {
                    id: "0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7",
                    name: "Aave Base WETH",
                  },
                  asset: {
                    id: WALLET_RESEARCH_SCOPE.tokens.weth.address,
                    symbol: "WETH",
                    decimals: 18,
                  },
                  side: "COLLATERAL",
                  type: null,
                  isCollateral: false,
                  balance: "1000000000000000",
                  blockNumberOpened: "91",
                  timestampOpened: "901",
                  snapshots: [
                    {
                      balance: "1000000000000000",
                      balanceUSD: "1.92",
                      blockNumber: "100",
                      timestamp: "990",
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await fetchWalletGraphPositions(record(), request, {
      apiKey: "test-key",
      fetchImpl,
      nowSeconds: 1_000,
    });

    expect(result).toMatchObject({
      status: "ok",
      positions: [
        {
          position_type: "lending_collateral",
          assets: [
            {
              raw_amount: "2000000000000000",
              normalized_amount: "0.002",
              usd_value: "3.84",
            },
          ],
          valuation: { usd_value: "3.84" },
        },
        {
          position_type: "lending_supply",
          assets: [{ role: "supplied" }],
        },
      ],
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    expect(requestUrl).not.toContain("test-key");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
  });

  it("keeps missing credentials inside the source boundary", async () => {
    const result = await fetchWalletGraphPositions(record(), request, {
      apiKey: "",
    });
    expect(result).toMatchObject({
      status: "error",
      positions: null,
      freshness: { status: "unavailable" },
    });
  });
});
