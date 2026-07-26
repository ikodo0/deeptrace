import { describe, expect, it, vi } from "vitest";

import { getSourceById } from "../../src/registry/index.js";
import type { NuthatchSourceRegistryRecord } from "../../src/registry/types.js";
import { WALLET_RESEARCH_SCOPE } from "../../src/scope/wallet-research.js";
import type { NuthatchClient } from "../../src/sources/nuthatch/client.js";
import { fetchNuthatchWalletActivity } from "../../src/sources/nuthatch/wallet-activity-adapter.js";
import { inspectWalletResearchQuery } from "../../src/tools/wallet-query.js";

const WALLET = "0x5cb3787a9c9c7547451ca3e6d8702453de35fe01";
const SENDER = "0x1111111111111111111111111111111111111111";
const REGISTRY_HASH = `0x${"12".repeat(32)}`;
const BLOCK_HASH = `0x${"34".repeat(32)}`;
const TX_HASH = `0x${"56".repeat(32)}`;

function record(): NuthatchSourceRegistryRecord {
  const source = getSourceById(WALLET_RESEARCH_SCOPE.nuthatch.sourceId);
  if (source === undefined || source.source_type !== "nuthatch_view") {
    throw new Error("Missing wallet Nuthatch fixture record");
  }
  return { ...source, deployment_or_view_id: REGISTRY_HASH };
}

function receipt(recipient = WALLET) {
  return {
    count: 1,
    provenance: {
      as_of: 100,
      registry_hash: REGISTRY_HASH,
      sealed_through: 100,
      source: "test",
    },
    rows: [
      {
        pool_address: WALLET_RESEARCH_SCOPE.poolAddress,
        block_number: 100,
        block_hash: BLOCK_HASH,
        block_timestamp: 990,
        transaction_hash: TX_HASH,
        log_index: 1,
        sender: SENDER,
        recipient,
        amount0_raw: "1000000000000000",
        amount1_raw: "-2000000",
      },
    ],
    truncated: false,
  };
}

function client(activityRecipient = WALLET): NuthatchClient {
  let sqlCall = 0;
  return {
    health: vi.fn(() => Promise.resolve({ ok: true, status: 200, body: {}, latencyMs: 1 })),
    ready: vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { ready: true, last_block: 100, tip: 100 },
        latencyMs: 1,
      }),
    ),
    nest: vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: { registry_hash: REGISTRY_HASH },
        latencyMs: 1,
      }),
    ),
    schema: vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        body: "wallet_swap_activity schema",
        latencyMs: 1,
      }),
    ),
    explain: vi.fn(() => Promise.resolve({ ok: true, status: 200, body: {}, latencyMs: 1 })),
    sql: vi.fn(() => {
      sqlCall += 1;
      return Promise.resolve({
        ok: true as const,
        status: 200,
        body: sqlCall === 1 ? receipt() : receipt(activityRecipient),
        latencyMs: 1,
      });
    }),
  };
}

describe("wallet Nuthatch adapter", () => {
  it("normalizes sender/recipient activity with exact token amounts", async () => {
    const result = await fetchNuthatchWalletActivity(
      { client: client(), clock: () => 1_000, record: record() },
      inspectWalletResearchQuery({
        chain_id: 8453,
        address: WALLET,
        limit: 5,
      }),
    );

    expect(result).toMatchObject({
      status: "ok",
      indexedHead: 100,
      activities: [
        {
          activity_type: "swap_received",
          counterparty: SENDER,
          assets: [
            { role: "swap_in", normalized_amount: "0.001" },
            { role: "swap_out", normalized_amount: "2" },
          ],
        },
      ],
    });
  });

  it("rejects rows outside the requested wallet", async () => {
    const result = await fetchNuthatchWalletActivity(
      {
        client: client("0x2222222222222222222222222222222222222222"),
        clock: () => 1_000,
        record: record(),
      },
      inspectWalletResearchQuery({
        chain_id: 8453,
        address: WALLET,
        limit: 5,
      }),
    );
    expect(result).toMatchObject({
      status: "unsupported",
      activities: null,
    });
  });
});
