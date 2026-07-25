import { describe, expect, it } from "vitest";

import {
  createNuthatchClient,
  NUTHATCH_DEFAULT_TIMEOUT_MS,
  NUTHATCH_MAX_ROWS_CEILING,
  NUTHATCH_MAX_ROWS_FLOOR,
  resetNuthatchSemaphores,
  type NuthatchHttpResult,
} from "./client.js";

interface FetchCall {
  readonly url: URL;
  readonly init: RequestInit;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
}

function makeRecordingFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const inputUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url: new URL(inputUrl), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) {
      return Promise.resolve(new Response("no scripted response", { status: 599 }));
    }
    return Promise.resolve(next);
  };
  return { fetchImpl, calls };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createNuthatchClient", () => {
  it("rejects an invalid baseUrl at construction", () => {
    expect(() => createNuthatchClient({ baseUrl: "not-a-url" })).toThrow();
  });

  it("rejects a baseUrl with embedded credentials", () => {
    expect(() => createNuthatchClient({ baseUrl: "https://user:pass@example.test" })).toThrow();
  });

  it("rejects non-loopback HTTP", () => {
    expect(() => createNuthatchClient({ baseUrl: "http://example.test" })).toThrow();
  });

  it("allows loopback HTTP for local tests", () => {
    expect(() => createNuthatchClient({ baseUrl: "http://127.0.0.1:8080" })).not.toThrow();
  });

  it("normalizes a single trailing slash from the base URL", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { ready: true })]);
    const client = createNuthatchClient({
      baseUrl: "https://example.test/",
      fetchImpl,
    });
    await client.ready();
    expect(calls[0]?.url.href).toBe("https://example.test/ready");
  });
});

describe("nuthatch client URL encoding", () => {
  it("encodes the /sql query and max_rows via URLSearchParams, never raw concatenation", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { rows: [] })]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    await client.sql("SELECT * FROM pool_swap_freshness LIMIT 1", 1);
    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.init.method).toBe("GET");
    expect(call?.url.pathname).toBe("/sql");
    expect(call?.url.searchParams.get("q")).toBe("SELECT * FROM pool_swap_freshness LIMIT 1");
    expect(call?.url.searchParams.get("max_rows")).toBe("1");
  });

  it("encodes /explain with the q parameter only", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { valid: true })]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    await client.explain("SELECT 1");
    expect(calls[0]?.url.pathname).toBe("/explain");
    expect(calls[0]?.url.searchParams.get("q")).toBe("SELECT 1");
    expect(calls[0]?.url.searchParams.has("max_rows")).toBe(false);
  });

  it("issues GET with no body and no authorization header", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([textResponse(200, "ok")]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    await client.health();
    const init = calls[0]?.init;
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    const headers = init?.headers;
    const auth =
      headers instanceof Headers
        ? headers.get("authorization")
        : typeof headers === "object" && headers !== null
          ? (headers as Record<string, string>).authorization
          : null;
    expect(auth).toBeNull();
  });
});

describe("nuthatch client result mapping", () => {
  it("returns ok with parsed JSON body for application/json 2xx", async () => {
    const { fetchImpl } = makeRecordingFetch([jsonResponse(200, { ready: true })]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.ready();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ready: true });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns ok with string body for text/plain 2xx", async () => {
    const { fetchImpl } = makeRecordingFetch([textResponse(200, "ok")]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("ok");
      expect(result.status).toBe(200);
    }
  });

  it("maps a non-2xx HTTP response to an http error", async () => {
    const { fetchImpl } = makeRecordingFetch([jsonResponse(500, { error: "boom" })]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.ready();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("http");
      expect(result.status).toBe(500);
      expect(result.error.message).toContain("/ready");
      expect(result.error.message).not.toContain("https://example.test");
    }
  });

  it("maps invalid JSON to invalid_json", async () => {
    const { fetchImpl } = makeRecordingFetch([
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.nest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_json");
    }
  });

  it("maps an oversized declared Content-Length to oversize without reading the body", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      new Response("", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(64 * 1024 * 1024 + 1),
        },
      }),
    ]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.schema();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("oversize");
    }
    // The byte ceiling must reject before the body is consumed.
    expect(calls.length).toBe(1);
  });

  it("redacts transport failures to an endpoint-named message", async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("ECONNREFUSED details"))) as unknown as typeof fetch;
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    const result = await client.nest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("transport");
      expect(result.error.message).toContain("/nest");
      expect(result.error.message).not.toContain("ECONNREFUSED");
    }
  });

  it("treats maxRows outside 1..50000 as an invalid_argument without calling fetch", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    for (const bad of [0, -1, 1.5, NUTHATCH_MAX_ROWS_CEILING + 1, Number.NaN]) {
      const result = await client.sql("SELECT 1", bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("invalid_argument");
      }
    }
    expect(calls.length).toBe(0);
  });

  it("accepts the row-limit floor and ceiling", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, { rows: [] }),
      jsonResponse(200, { rows: [] }),
    ]);
    const client = createNuthatchClient({ baseUrl: "https://example.test", fetchImpl });
    await client.sql("SELECT 1", NUTHATCH_MAX_ROWS_FLOOR);
    await client.sql("SELECT 1", NUTHATCH_MAX_ROWS_CEILING);
    expect(calls[0]?.url.searchParams.get("max_rows")).toBe(String(NUTHATCH_MAX_ROWS_FLOOR));
    expect(calls[1]?.url.searchParams.get("max_rows")).toBe(String(NUTHATCH_MAX_ROWS_CEILING));
  });

  it("defaults the timeout to 15000ms", () => {
    expect(NUTHATCH_DEFAULT_TIMEOUT_MS).toBe(15_000);
  });
});

describe("nuthatch client timeout", () => {
  it("maps an aborted request to a timeout error", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const client = createNuthatchClient({
      baseUrl: "https://example.test",
      fetchImpl,
      timeoutMs: 30,
    });
    const result = await client.nest();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      expect(result.status).toBeNull();
    }
  });
});

describe("nuthatch per-origin SQL limiter", () => {
  interface PendingFetch {
    readonly url: URL;
    readonly resolve: (response: Response) => void;
  }

  function makeControlledFetch(): { fetchImpl: typeof fetch; pending: PendingFetch[] } {
    const pending: PendingFetch[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      return new Promise<Response>((resolve) => {
        const inputUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        pending.push({ url: new URL(inputUrl), resolve });
        // Touch the signal so AbortController does not warn about unhandled abort.
        void init?.signal;
      });
    };
    return { fetchImpl, pending };
  }

  it("allows at most two concurrent /sql requests per origin and queues the third", async () => {
    resetNuthatchSemaphores();
    const { fetchImpl, pending } = makeControlledFetch();
    const client = createNuthatchClient({
      baseUrl: "https://example.test",
      fetchImpl,
      timeoutMs: 5_000,
    });

    const p1 = client.sql("SELECT 1", 1);
    const p2 = client.sql("SELECT 2", 1);
    const p3 = client.sql("SELECT 3", 1);

    // Yield so acquisition + fetch dispatch settles.
    await sleep(0);
    expect(pending.length).toBe(2);

    // Release one permit; the queued third request must then start.
    pending[0]?.resolve(jsonResponse(200, { rows: [] }));
    await p1;
    await sleep(0);
    expect(pending.length).toBe(3);

    pending[1]?.resolve(jsonResponse(200, { rows: [] }));
    pending[2]?.resolve(jsonResponse(200, { rows: [] }));
    await Promise.all([p2, p3]);
  });

  it("releases a permit when an in-flight request is aborted", async () => {
    resetNuthatchSemaphores();
    const inflight: Array<(err: Error) => void> = [];
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        inflight.push(reject);
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const client = createNuthatchClient({
      baseUrl: "https://example.test",
      fetchImpl,
      timeoutMs: 20,
    });

    const p1 = client.sql("SELECT 1", 1);
    const p2 = client.sql("SELECT 2", 1);
    // Third will time out while queued unless a permit frees.
    const p3 = client.sql("SELECT 3", 1);
    await sleep(0);

    // Wait for p1 to time out (20ms). The permit must release and p3 must
    // acquire it rather than timing out while queued.
    const r1: NuthatchHttpResult = await p1;
    expect(r1.ok).toBe(false);

    // p3 should now be in flight (permit released by p1's timeout).
    await sleep(0);
    // p2 is still holding the second permit; resolve it so the suite cleans up.
    inflight[0]?.(new Error("done"));
    await p2.catch(() => undefined);

    // p3 acquired the released permit; let it complete by aborting via timeout.
    const r3 = await p3;
    expect(r3.ok).toBe(false);
  });
});
