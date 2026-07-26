import { request as httpRequest } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { isAuthorized } from "../../src/http/auth.js";
import {
  HTTP_DEFAULTS,
  HTTP_ENV_VARS,
  HTTP_MAXIMUMS,
  MIN_TOKEN_LENGTH,
  loadHttpConfig,
  type HttpConfig,
} from "../../src/http/config.js";
import { ConfigurationError } from "../../src/errors/index.js";
import {
  createHttpServer,
  listen,
  type HttpRuntime,
  type HttpServerOptions,
} from "../../src/http/server.js";

// Wrap createMcpServer so each spawned McpServer reports its close() through
// closeSpy. This lets the lifecycle tests assert disposal without measuring
// memory, while keeping the real server wiring (tool registration, connect).
const closeSpy = vi.hoisted(() => vi.fn());
// Toggle to make openSession() fail at createMcpServer() for the reservation
// leak regression test. Defaults to false so other tests are unaffected.
const openSessionFailure = vi.hoisted(() => ({ enabled: false }));

vi.mock("../../src/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/mcp/server.js")>();
  return {
    ...actual,
    createMcpServer: (...args: Parameters<typeof actual.createMcpServer>) => {
      if (openSessionFailure.enabled) {
        throw new Error("openSession forced failure");
      }
      const server = actual.createMcpServer(...args);
      const originalClose = server.close.bind(server);
      server.close = async () => {
        closeSpy();
        await originalClose();
      };
      return server;
    },
  };
});

const VALID_TOKEN = "a".repeat(MIN_TOKEN_LENGTH);

describe("loadHttpConfig", () => {
  it("returns documented defaults when only the token is supplied", () => {
    expect(loadHttpConfig({ [HTTP_ENV_VARS.token]: VALID_TOKEN })).toEqual({
      host: HTTP_DEFAULTS.host,
      port: HTTP_DEFAULTS.port,
      sessionIdleTimeoutMs: HTTP_DEFAULTS.sessionIdleTimeoutMs,
      sessionSweepIntervalMs: HTTP_DEFAULTS.sessionSweepIntervalMs,
      token: VALID_TOKEN,
    });
  });

  it("applies valid overrides", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.host]: "0.0.0.0",
        [HTTP_ENV_VARS.port]: "9000",
        [HTTP_ENV_VARS.sessionIdleTimeoutMs]: "120000",
        [HTTP_ENV_VARS.sessionSweepIntervalMs]: "30000",
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 9_000,
      sessionIdleTimeoutMs: 120_000,
      sessionSweepIntervalMs: 30_000,
      token: VALID_TOKEN,
    });
  });

  it("accepts the highest bindable port", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.port]: String(HTTP_MAXIMUMS.port),
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }).port,
    ).toBe(HTTP_MAXIMUMS.port);
  });

  it("treats blank overrides as absent", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.host]: "   ",
        [HTTP_ENV_VARS.port]: "  ",
        [HTTP_ENV_VARS.sessionIdleTimeoutMs]: " ",
        [HTTP_ENV_VARS.sessionSweepIntervalMs]: "",
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({
      host: HTTP_DEFAULTS.host,
      port: HTTP_DEFAULTS.port,
      sessionIdleTimeoutMs: HTTP_DEFAULTS.sessionIdleTimeoutMs,
      sessionSweepIntervalMs: HTTP_DEFAULTS.sessionSweepIntervalMs,
      token: VALID_TOKEN,
    });
  });

  it("rejects a missing token", () => {
    expect(() => loadHttpConfig({})).toThrow(ConfigurationError);
  });

  it("rejects a token shorter than the minimum length", () => {
    expect(() =>
      loadHttpConfig({ [HTTP_ENV_VARS.token]: "a".repeat(MIN_TOKEN_LENGTH - 1) }),
    ).toThrow(ConfigurationError);
  });

  it("rejects invalid session cleanup timer overrides", () => {
    try {
      loadHttpConfig({
        [HTTP_ENV_VARS.sessionIdleTimeoutMs]: "0",
        [HTTP_ENV_VARS.sessionSweepIntervalMs]: String(HTTP_MAXIMUMS.sessionSweepIntervalMs + 1),
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      });
      expect.unreachable("expected ConfigurationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variableNames).toEqual([
        HTTP_ENV_VARS.sessionIdleTimeoutMs,
        HTTP_ENV_VARS.sessionSweepIntervalMs,
      ]);
    }
  });

  it("names every invalid variable", () => {
    try {
      loadHttpConfig({ [HTTP_ENV_VARS.port]: "0" });
      expect.unreachable("expected ConfigurationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variableNames).toEqual([
        HTTP_ENV_VARS.port,
        HTTP_ENV_VARS.token,
      ]);
    }
  });
});

describe("isAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorized(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(undefined, VALID_TOKEN)).toBe(false);
  });

  it("rejects a token that differs only in the final byte", () => {
    expect(isAuthorized(`Bearer ${"a".repeat(MIN_TOKEN_LENGTH - 1)}b`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(isAuthorized(`Bearer ${VALID_TOKEN}extra`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a non-bearer scheme carrying the right secret", () => {
    expect(isAuthorized(`Basic ${VALID_TOKEN}`, VALID_TOKEN)).toBe(false);
  });

  it("rejects a bare token with no scheme", () => {
    expect(isAuthorized(VALID_TOKEN, VALID_TOKEN)).toBe(false);
  });
});

const VALID_TOKEN_32 = "a".repeat(MIN_TOKEN_LENGTH);

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "deeptrace-test", version: "0.0.0" },
  },
} as const;

interface TestServer {
  readonly runtime: HttpRuntime;
  readonly base: string;
}

interface TestServerOptions {
  readonly config?: Partial<HttpConfig>;
  readonly server?: HttpServerOptions;
}

async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const config: HttpConfig = {
    ...HTTP_DEFAULTS,
    host: "127.0.0.1",
    port: 0,
    token: VALID_TOKEN_32,
    ...options.config,
  };
  const runtime = createHttpServer(config, options.server);
  await listen(runtime, config);
  const address = runtime.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a port");
  }
  return { runtime, base: `http://127.0.0.1:${address.port}/mcp` };
}

async function postInitialize(
  base: string,
  options: { readonly accept: string },
): Promise<Response> {
  return fetch(base, {
    method: "POST",
    headers: {
      authorization: `Bearer ${VALID_TOKEN_32}`,
      "content-type": "application/json",
      accept: options.accept,
    },
    body: JSON.stringify(INITIALIZE_BODY),
  });
}

async function postInitialized(base: string, sessionId: string): Promise<Response> {
  return fetch(base, {
    method: "POST",
    headers: {
      authorization: `Bearer ${VALID_TOKEN_32}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
}

function requireSessionId(response: Response): string {
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId === null) {
    throw new Error("expected mcp-session-id response header");
  }
  return sessionId;
}

function createFakeSessionTimer(): {
  readonly options: HttpServerOptions;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly schedule: ReturnType<typeof vi.fn>;
  advance(ms: number): void;
  sweep(): Promise<void>;
} {
  let nowMs = 0;
  let sweepCallback: (() => Promise<void>) | undefined;
  const cancel = vi.fn();
  const schedule = vi.fn((callback: () => Promise<void>) => {
    sweepCallback = callback;
    return cancel;
  });

  return {
    options: {
      now: () => nowMs,
      scheduleSessionSweep: schedule,
    },
    cancel,
    schedule,
    advance(ms: number) {
      nowMs += ms;
    },
    async sweep() {
      if (sweepCallback === undefined) {
        throw new Error("session sweep was not scheduled");
      }
      await sweepCallback();
    },
  };
}

async function getBrowserNavigation(base: string): Promise<{
  readonly status: number | undefined;
  readonly challenge: string | undefined;
  readonly body: unknown;
}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      base,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "sec-fetch-mode": "navigate",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            challenge: response.headers["www-authenticate"],
            body: JSON.parse(body) as unknown,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("HTTP authentication", () => {
  it("returns a challenge-free 404 for top-level browser navigation", async () => {
    const { runtime, base } = await startTestServer();
    try {
      const response = await getBrowserNavigation(base);

      expect(response.status).toBe(404);
      expect(response.challenge).toBeUndefined();
      expect(response.body).toEqual({
        error: {
          code: "not_found",
          message: "This endpoint is available to MCP clients",
        },
      });
    } finally {
      await runtime.close();
    }
  });

  it("retains the Bearer challenge for unauthorized MCP requests", async () => {
    const { runtime, base } = await startTestServer();
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(INITIALIZE_BODY),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="deeptrace"');
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "unauthorized",
          message: "Missing or invalid bearer token",
        },
      });
    } finally {
      await runtime.close();
    }
  });
});

describe("HTTP session lifecycle", () => {
  it("disposes the McpServer/transport when initialize is rejected (406)", async () => {
    const { runtime, base } = await startTestServer();
    closeSpy.mockClear();
    try {
      const response = await postInitialize(base, {
        accept: "application/json",
      });

      expect(response.status).toBe(406);
      await vi.waitFor(() => {
        expect(closeSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      await runtime.close();
    }
  });

  it("does not accumulate sessions across repeated failed initializes", async () => {
    const { runtime, base } = await startTestServer();
    closeSpy.mockClear();
    try {
      for (let i = 0; i < 3; i += 1) {
        const response = await postInitialize(base, { accept: "application/json" });
        expect(response.status).toBe(406);
      }

      await vi.waitFor(() => {
        expect(closeSpy).toHaveBeenCalledTimes(3);
      });

      // A subsequent valid initialize must still succeed and register exactly
      // one session, proving the failed opens left nothing behind.
      const valid = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      expect(valid.status).toBe(200);
      expect(valid.headers.get("mcp-session-id")).not.toBeNull();
      // The valid session stays open: close count must not have grown.
      expect(closeSpy).toHaveBeenCalledTimes(3);
    } finally {
      await runtime.close();
    }
  });

  it("refreshes activity and disposes a session only after a full idle timeout", async () => {
    const timer = createFakeSessionTimer();
    const { runtime, base } = await startTestServer({
      config: {
        sessionIdleTimeoutMs: 1_000,
        sessionSweepIntervalMs: 100,
      },
      server: timer.options,
    });
    closeSpy.mockClear();
    try {
      expect(timer.schedule).toHaveBeenCalledWith(expect.any(Function), 100);
      const initialized = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      expect(initialized.status).toBe(200);
      const sessionId = requireSessionId(initialized);
      await initialized.text();

      timer.advance(999);
      const activity = await postInitialized(base, sessionId);
      expect(activity.status).toBe(202);
      await activity.text();

      timer.advance(999);
      await timer.sweep();
      expect(closeSpy).not.toHaveBeenCalled();

      timer.advance(1);
      await timer.sweep();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
    expect(timer.cancel).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("expires an otherwise-idle session with an open SSE stream", async () => {
    const timer = createFakeSessionTimer();
    const { runtime, base } = await startTestServer({
      config: {
        sessionIdleTimeoutMs: 1_000,
        sessionSweepIntervalMs: 100,
      },
      server: timer.options,
    });
    closeSpy.mockClear();
    try {
      const initialized = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      const sessionId = requireSessionId(initialized);
      await initialized.text();

      const stream = await fetch(base, {
        headers: {
          authorization: `Bearer ${VALID_TOKEN_32}`,
          accept: "text/event-stream",
          "mcp-session-id": sessionId,
        },
      });
      expect(stream.status).toBe(200);

      timer.advance(1_000);
      await timer.sweep();
      expect(closeSpy).toHaveBeenCalledTimes(1);
      await stream.text();
    } finally {
      await runtime.close();
    }
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("releases all session-limit slots after idle expiration", async () => {
    const timer = createFakeSessionTimer();
    const { runtime, base } = await startTestServer({
      config: {
        sessionIdleTimeoutMs: 1_000,
        sessionSweepIntervalMs: 100,
      },
      server: timer.options,
    });
    closeSpy.mockClear();
    try {
      for (let i = 0; i < 64; i += 1) {
        const response = await postInitialize(base, {
          accept: "application/json, text/event-stream",
        });
        expect(response.status).toBe(200);
        await response.text();
      }

      timer.advance(1_000);
      await timer.sweep();
      expect(closeSpy).toHaveBeenCalledTimes(64);

      const replacement = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      expect(replacement.status).toBe(200);
      expect(replacement.headers.get("mcp-session-id")).not.toBeNull();
      await replacement.text();
    } finally {
      await runtime.close();
    }
    expect(closeSpy).toHaveBeenCalledTimes(65);
  });

  it("does not close a session twice when DELETE and the sweep converge", async () => {
    const timer = createFakeSessionTimer();
    const { runtime, base } = await startTestServer({
      config: {
        sessionIdleTimeoutMs: 1_000,
        sessionSweepIntervalMs: 100,
      },
      server: timer.options,
    });
    closeSpy.mockClear();
    try {
      const initialized = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      const sessionId = requireSessionId(initialized);
      await initialized.text();

      const deleted = await fetch(base, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${VALID_TOKEN_32}`,
          "mcp-session-id": sessionId,
        },
      });
      expect(deleted.status).toBe(200);
      await deleted.text();
      await vi.waitFor(() => {
        expect(closeSpy).toHaveBeenCalledTimes(1);
      });

      timer.advance(1_000);
      await timer.sweep();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels the sweep and closes each session once during shutdown", async () => {
    const timer = createFakeSessionTimer();
    const { runtime, base } = await startTestServer({
      config: {
        sessionIdleTimeoutMs: 1_000,
        sessionSweepIntervalMs: 100,
      },
      server: timer.options,
    });
    closeSpy.mockClear();

    const initialized = await postInitialize(base, {
      accept: "application/json, text/event-stream",
    });
    expect(initialized.status).toBe(200);
    await initialized.text();

    await runtime.close();
    expect(timer.cancel).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    timer.advance(1_000);
    await timer.sweep();
    await runtime.close();
    expect(timer.cancel).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects with 503 once MAX_SESSIONS live sessions exist", async () => {
    const { runtime, base } = await startTestServer();
    closeSpy.mockClear();
    try {
      // Open MAX_SESSIONS successful sessions. Each initialize registers one
      // session and leaves the SSE response stream open; reading the body to
      // completion lets the server finalize each request.
      for (let i = 0; i < 64; i += 1) {
        const response = await postInitialize(base, {
          accept: "application/json, text/event-stream",
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("mcp-session-id")).not.toBeNull();
        await response.text();
      }

      const overflow = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      expect(overflow.status).toBe(503);
      // No new McpServer should have been created for the rejected request.
      expect(closeSpy).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it("releases the session reservation when openSession throws", async () => {
    // Regression: pendingOpens += 1 used to sit outside the try, so a failing
    // openSession() left the counter incremented forever. After MAX_SESSIONS
    // such failures the 503 guard would be permanently true with zero live
    // sessions. The fix decrements in a finally that wraps openSession too.
    const { runtime, base } = await startTestServer();
    closeSpy.mockClear();
    openSessionFailure.enabled = true;
    try {
      for (let i = 0; i < 64; i += 1) {
        const response = await postInitialize(base, {
          accept: "application/json, text/event-stream",
        });
        expect(response.status).toBe(500);
      }
      // No session was ever created, so close() must never have run.
      expect(closeSpy).not.toHaveBeenCalled();

      // Re-enable the happy path: a fresh initialize must still succeed,
      // proving every failed reservation was returned to the pool.
      openSessionFailure.enabled = false;
      const valid = await postInitialize(base, {
        accept: "application/json, text/event-stream",
      });
      expect(valid.status).toBe(200);
      expect(valid.headers.get("mcp-session-id")).not.toBeNull();
    } finally {
      openSessionFailure.enabled = false;
      await runtime.close();
    }
  });
});
