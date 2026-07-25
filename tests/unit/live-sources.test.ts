import { describe, expect, it, vi } from "vitest";

import { nuthatchSourceResultSchema } from "../../src/schemas/source-adapter.js";
import {
  BLOCK_HASH,
  QUERIED_AT,
  REGISTRY_HASH,
  ROW,
} from "../../src/sources/nuthatch/adapter-fixtures.js";
import { NUTHATCH_FRESHNESS_QUERY } from "../../src/sources/nuthatch/freshness-query.js";
import { createLiveComparePoolsSources } from "../../src/tools/live-sources.js";
import { lockedComparePoolsRequest } from "../fixtures/compare-pools-request.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("live Nuthatch source", () => {
  it("uses the registry-named environment URL and invokes the real client/adapter path", async () => {
    const requests: URL[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url);

      switch (url.pathname) {
        case "/ready":
          return Promise.resolve(json({ ready: true }));
        case "/nest":
          return Promise.resolve(
            json({ registry_hash: REGISTRY_HASH, name: "deeptrace", table_count: 9 }),
          );
        case "/schema":
          return Promise.resolve(
            new Response("nuthatch data model", {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          );
        case "/sql":
          return Promise.resolve(json({ count: 1, provenance: {}, rows: [ROW], truncated: false }));
        default:
          return Promise.resolve(new Response("not found", { status: 404 }));
      }
    });
    const sources = createLiveComparePoolsSources({
      environment: { NUTHATCH_BASE_URL: "https://nuthatch.internal" },
      fetchImpl,
      nuthatchClock: () => QUERIED_AT,
    });

    const result = await sources.fetchNuthatchResult(lockedComparePoolsRequest);

    expect(nuthatchSourceResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      source_id: "nuthatch-pool-swaps",
      status: "ok",
      data: ROW,
      freshness: {
        indexed_block_hash: BLOCK_HASH,
        queried_at: QUERIED_AT,
      },
      provenance: {
        deployment_or_view_id: REGISTRY_HASH,
        query_id: "nuthatch-pool-swap-freshness-v1",
      },
    });
    expect(new Set(requests.map((url) => url.pathname))).toEqual(
      new Set(["/ready", "/nest", "/schema", "/sql"]),
    );
    expect(requests.every((url) => url.origin === "https://nuthatch.internal")).toBe(true);
    const sqlRequest = requests.find((url) => url.pathname === "/sql");
    expect(sqlRequest?.searchParams.get("q")).toBe(NUTHATCH_FRESHNESS_QUERY);
    expect(sqlRequest?.searchParams.get("max_rows")).toBe("1");
  });

  it("returns a typed registry-backed failure when the environment URL is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const sources = createLiveComparePoolsSources({
      environment: {},
      fetchImpl,
      nuthatchClock: () => QUERIED_AT,
    });

    const result = await sources.fetchNuthatchResult(lockedComparePoolsRequest);

    expect(nuthatchSourceResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      source_id: "nuthatch-pool-swaps",
      source_type: "nuthatch_view",
      status: "error",
      data: null,
      freshness: null,
      provenance: {
        deployment_or_view_id: REGISTRY_HASH,
        query_id: "nuthatch-pool-swap-freshness-v1",
      },
    });
    expect(result?.warnings).toEqual([
      "Nuthatch source is unavailable because NUTHATCH_BASE_URL is not configured.",
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("contains transport failures as non-ok results without exposing the URL", async () => {
    const baseUrl = "https://sensitive-nuthatch.internal";
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error(`connect ECONNREFUSED ${baseUrl}`)),
    );
    const sources = createLiveComparePoolsSources({
      environment: { NUTHATCH_BASE_URL: baseUrl },
      fetchImpl,
      timeoutMs: 20,
      nuthatchClock: () => QUERIED_AT,
    });

    const result = await sources.fetchNuthatchResult(lockedComparePoolsRequest);

    expect(nuthatchSourceResultSchema.parse(result)).toEqual(result);
    expect(result?.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(baseUrl);
  });
});
