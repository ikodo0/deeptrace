import { describe, expect, it, vi } from "vitest";

import { LSS_SCOPE } from "../../src/scope/index.js";
import { createLiveLargeSwapSource, executeFindLargeSwaps } from "../../src/tools/index.js";
import { lockedLargeSwapsRequest } from "../fixtures/large-swaps-request.js";

const REGISTRY_HASH = "0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25";
const ROW = {
  pool_address: LSS_SCOPE.poolAddress,
  block_number: 48_944_373,
  block_hash: `0x${"a".repeat(64)}`,
  block_timestamp: 1_784_678_093,
  transaction_hash: `0x${"b".repeat(64)}`,
  log_index: 168,
  amount0_raw: "-6123995143586742520",
  amount1_raw: "11804868893",
} as const;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function receipt(rows: readonly unknown[]) {
  return {
    count: rows.length,
    provenance: {
      as_of: 48_944_374,
      registry_hash: REGISTRY_HASH,
      sealed_through: 48_944_374,
      source: "hot+sealed",
    },
    rows,
    truncated: false,
  };
}

describe("live find_large_swaps source", () => {
  it("uses the registry URL and real client/adapter path", async () => {
    const requests: URL[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url);
      switch (url.pathname) {
        case "/ready":
          return Promise.resolve(
            json({ ready: true, sealed_through: 48_944_374, tip: 48_944_374 }),
          );
        case "/nest":
          return Promise.resolve(json({ registry_hash: REGISTRY_HASH }));
        case "/schema":
          return Promise.resolve(
            new Response("Nuthatch schema", {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          );
        case "/sql":
          return Promise.resolve(json(receipt([ROW])));
        default:
          return Promise.resolve(new Response("not found", { status: 404 }));
      }
    });
    const source = createLiveLargeSwapSource({
      environment: { NUTHATCH_BASE_URL: "https://nuthatch.internal" },
      fetchImpl,
      clock: () => ROW.block_timestamp + 60,
    });

    const response = await executeFindLargeSwaps(
      { ...lockedLargeSwapsRequest, min_amount: "5", limit: 1 },
      source,
    );

    expect(response).toMatchObject({
      status: "complete",
      data: {
        swaps: [{ transaction_hash: ROW.transaction_hash, amount_out: "6.12399514358674252" }],
      },
    });
    expect(new Set(requests.map(({ pathname }) => pathname))).toEqual(
      new Set(["/ready", "/nest", "/schema", "/sql"]),
    );
    expect(requests.every(({ origin }) => origin === "https://nuthatch.internal")).toBe(true);
    const sqlQueries = requests
      .filter(({ pathname }) => pathname === "/sql")
      .map(({ searchParams }) => searchParams.get("q") ?? "");
    expect(sqlQueries).toHaveLength(2);
    expect(sqlQueries.every((query) => query.includes("pool_swap_search"))).toBe(true);
    expect(sqlQueries.every((query) => !query.includes(LSS_SCOPE.tokens.weth.address))).toBe(true);
  });

  it("returns failed when the source URL is absent and redacts transport details", async () => {
    const missing = createLiveLargeSwapSource({ environment: {} });
    await expect(executeFindLargeSwaps(lockedLargeSwapsRequest, missing)).resolves.toMatchObject({
      status: "failed",
      warnings: ["Large-swap source is unavailable because NUTHATCH_BASE_URL is not configured."],
    });

    const secretUrl = "https://secret-nuthatch.internal";
    const rejected = createLiveLargeSwapSource({
      environment: { NUTHATCH_BASE_URL: secretUrl },
      fetchImpl: vi.fn(() => Promise.reject(new Error(`connect ${secretUrl} admin-token`))),
    });
    const response = await executeFindLargeSwaps(lockedLargeSwapsRequest, rejected);
    expect(response.status).toBe("failed");
    expect(JSON.stringify(response)).not.toContain(secretUrl);
    expect(JSON.stringify(response)).not.toContain("admin-token");
  });
});
