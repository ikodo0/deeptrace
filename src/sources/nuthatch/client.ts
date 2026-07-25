/**
 * Bounded read-only HTTP client for Nuthatch v0.6.1 GET endpoints.
 *
 * The client is dependency-injected: tests pass a fake `fetch`, production
 * passes the global. It never throws for operational conditions (timeout,
 * transport failure, HTTP error, invalid JSON, oversized response); every
 * failure is returned as a discriminated {@link NuthatchHttpResult}. The only
 * throws are programmer errors (invalid arguments to the constructor or
 * method calls), which the adapter boundary catches and maps to `error`.
 */

export const NUTHATCH_DEFAULT_TIMEOUT_MS = 15_000 as const;
export const NUTHATCH_MAX_ROWS_FLOOR = 1 as const;
export const NUTHATCH_MAX_ROWS_CEILING = 50_000 as const;
export const NUTHATCH_RESPONSE_BYTE_CEILING = 64 * 1024 * 1024;

export type NuthatchHttpErrorKind =
  "timeout" | "transport" | "http" | "invalid_json" | "oversize" | "invalid_argument";

export interface NuthatchHttpError {
  readonly kind: NuthatchHttpErrorKind;
  readonly message: string;
}

export interface NuthatchHttpOk {
  readonly ok: true;
  readonly status: number;
  readonly body: unknown;
  readonly latencyMs: number;
}

export interface NuthatchHttpErr {
  readonly ok: false;
  readonly status: number | null;
  readonly error: NuthatchHttpError;
  readonly latencyMs: number;
}

export type NuthatchHttpResult = NuthatchHttpOk | NuthatchHttpErr;

export interface NuthatchClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface Permit {
  readonly release: () => void;
}

interface Semaphore {
  available: number;
  queue: Array<() => void>;
}

const semaphores = new Map<string, Semaphore>();

function originKey(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function getSemaphore(origin: string): Semaphore {
  let sem = semaphores.get(origin);
  if (sem === undefined) {
    sem = { available: 2, queue: [] };
    semaphores.set(origin, sem);
  }
  return sem;
}

function drain(sem: Semaphore): void {
  while (sem.available > 0 && sem.queue.length > 0) {
    const next = sem.queue.shift();
    if (next !== undefined) {
      sem.available -= 1;
      next();
    }
  }
}

function acquireWithDeadline(origin: string, deadlineAt: number): Promise<Permit | null> {
  return new Promise((resolve) => {
    const sem = getSemaphore(origin);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      resolve(null);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      // The queued callback will no-op when invoked because `settled` is true.
      resolve(null);
    }, remaining);

    sem.queue.push(() => {
      if (settled) {
        // Permit arrived after the deadline expired; release immediately so
        // another queued caller can use it.
        sem.available += 1;
        drain(sem);
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        release: () => {
          sem.available += 1;
          drain(sem);
        },
      });
    });
    drain(sem);
  });
}

interface NormalizedBase {
  readonly url: URL;
  readonly origin: string;
}

function normalizeBaseUrl(raw: string): NormalizedBase {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Nuthatch baseUrl is not a valid URL.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("Nuthatch baseUrl must not embed credentials.");
  }

  const isLoopbackHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    throw new Error("Nuthatch baseUrl must use HTTPS, except loopback HTTP for local tests.");
  }

  // Normalize away a single trailing slash on the path root so endpoint paths
  // compose without producing `//`.
  if (url.pathname.endsWith("/") && url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return { url, origin: originKey(url) };
}

function isJsonContentType(response: Response): boolean {
  const ct = response.headers.get("content-type");
  if (ct === null) {
    return false;
  }
  return ct.toLowerCase().includes("application/json");
}

async function readBoundedText(
  response: Response,
  ceiling: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: "oversize" }> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    if (Number.isFinite(parsed) && parsed > ceiling) {
      return { ok: false, reason: "oversize" };
    }
  }

  if (response.body === null) {
    const text = await response.text();
    if (text.length > ceiling) {
      return { ok: false, reason: "oversize" };
    }
    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        received += value.length;
        if (received > ceiling) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, reason: "oversize" };
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  return { ok: true, text };
}

function safeErrorMessage(error: unknown, endpoint: string, timedOut: boolean): string {
  if (timedOut) {
    return `${endpoint} request exceeded the configured timeout.`;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return `${endpoint} request was aborted.`;
  }
  return `${endpoint} request failed; details were redacted.`;
}

export interface NuthatchClient {
  readonly health: () => Promise<NuthatchHttpResult>;
  readonly ready: () => Promise<NuthatchHttpResult>;
  readonly nest: () => Promise<NuthatchHttpResult>;
  readonly schema: () => Promise<NuthatchHttpResult>;
  readonly explain: (query: string) => Promise<NuthatchHttpResult>;
  readonly sql: (query: string, maxRows: number) => Promise<NuthatchHttpResult>;
}

export function createNuthatchClient(options: NuthatchClientOptions): NuthatchClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? NUTHATCH_DEFAULT_TIMEOUT_MS;
  const base = normalizeBaseUrl(options.baseUrl);

  async function request(
    endpoint: string,
    path: string,
    query: URLSearchParams | null,
    options: { readonly consumeSqlPermit: boolean },
  ): Promise<NuthatchHttpResult> {
    const url = new URL(path, base.url);
    if (query !== null) {
      url.search = query.toString();
    }

    const deadlineAt = Date.now() + timeoutMs;
    const startedAt = performance.now();

    let permit: Permit | null = null;
    if (options.consumeSqlPermit) {
      permit = await acquireWithDeadline(base.origin, deadlineAt);
      if (permit === null) {
        return {
          ok: false,
          status: null,
          error: {
            kind: "timeout",
            message: `${endpoint} request exceeded the configured timeout while queued.`,
          },
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }
    }

    const controller = new AbortController();
    const remaining = Math.max(1, deadlineAt - Date.now());
    const timer = setTimeout(() => controller.abort(), remaining);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "error",
      });

      const bounded = await readBoundedText(response, NUTHATCH_RESPONSE_BYTE_CEILING);
      if (!bounded.ok) {
        return {
          ok: false,
          status: response.status,
          error: { kind: "oversize", message: `${endpoint} response exceeded the byte ceiling.` },
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }

      const contentTypeJson = isJsonContentType(response);
      let body: unknown;
      if (contentTypeJson) {
        try {
          body = JSON.parse(bounded.text) as unknown;
        } catch {
          return {
            ok: false,
            status: response.status,
            error: { kind: "invalid_json", message: `${endpoint} returned a non-JSON response.` },
            latencyMs: Math.round(performance.now() - startedAt),
          };
        }
      } else {
        body = bounded.text;
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          status: response.status,
          error: { kind: "http", message: `${endpoint} returned HTTP ${String(response.status)}.` },
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }

      return {
        ok: true,
        status: response.status,
        body,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        status: null,
        error: {
          kind: timedOut ? "timeout" : "transport",
          message: safeErrorMessage(error, endpoint, timedOut),
        },
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      clearTimeout(timer);
      if (permit !== null) {
        permit.release();
      }
    }
  }

  function validateMaxRows(maxRows: number): NuthatchHttpErr | null {
    if (
      !Number.isInteger(maxRows) ||
      maxRows < NUTHATCH_MAX_ROWS_FLOOR ||
      maxRows > NUTHATCH_MAX_ROWS_CEILING
    ) {
      return {
        ok: false,
        status: null,
        error: {
          kind: "invalid_argument",
          message: `max_rows must be an integer in 1..50000; received ${String(maxRows)}.`,
        },
        latencyMs: 0,
      };
    }
    return null;
  }

  return {
    health() {
      return request("/health", "/health", null, { consumeSqlPermit: false });
    },
    ready() {
      return request("/ready", "/ready", null, { consumeSqlPermit: false });
    },
    nest() {
      return request("/nest", "/nest", null, { consumeSqlPermit: false });
    },
    schema() {
      return request("/schema", "/schema", null, { consumeSqlPermit: false });
    },
    explain(query: string) {
      const params = new URLSearchParams();
      params.set("q", query);
      return request("/explain", "/explain", params, { consumeSqlPermit: false });
    },
    sql(query: string, maxRows: number) {
      const invalid = validateMaxRows(maxRows);
      if (invalid !== null) {
        return Promise.resolve(invalid);
      }
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("max_rows", String(maxRows));
      return request("/sql", "/sql", params, { consumeSqlPermit: true });
    },
  };
}

/**
 * Drops every shared per-origin SQL semaphore. Tests that assert on
 * concurrency isolation call this between cases so a prior test's released
 * permits do not mask a fresh client's behavior.
 */
export function resetNuthatchSemaphores(): void {
  semaphores.clear();
}
