import { describe, expect, it, vi } from "vitest";

import { isAuthorized } from "../../src/http/auth.js";
import {
  HTTP_DEFAULTS,
  HTTP_ENV_VARS,
  HTTP_MAXIMUMS,
  MIN_TOKEN_LENGTH,
  loadHttpConfig,
} from "../../src/http/config.js";
import { ConfigurationError } from "../../src/errors/index.js";
import { createHttpServer, listen, type HttpRuntime } from "../../src/http/server.js";

// Wrap createMcpServer so each spawned McpServer reports its close() through
// closeSpy. This lets the lifecycle tests assert disposal without measuring
// memory, while keeping the real server wiring (tool registration, connect).
const closeSpy = vi.hoisted(() => vi.fn());

vi.mock("../../src/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/mcp/server.js")>();
  return {
    ...actual,
    createMcpServer: (...args: Parameters<typeof actual.createMcpServer>) => {
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
      token: VALID_TOKEN,
    });
  });

  it("applies valid overrides", () => {
    expect(
      loadHttpConfig({
        [HTTP_ENV_VARS.host]: "0.0.0.0",
        [HTTP_ENV_VARS.port]: "9000",
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({ host: "0.0.0.0", port: 9_000, token: VALID_TOKEN });
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
        [HTTP_ENV_VARS.token]: VALID_TOKEN,
      }),
    ).toEqual({ host: HTTP_DEFAULTS.host, port: HTTP_DEFAULTS.port, token: VALID_TOKEN });
  });

  it("rejects a missing token", () => {
    expect(() => loadHttpConfig({})).toThrow(ConfigurationError);
  });

  it("rejects a token shorter than the minimum length", () => {
    expect(() =>
      loadHttpConfig({ [HTTP_ENV_VARS.token]: "a".repeat(MIN_TOKEN_LENGTH - 1) }),
    ).toThrow(ConfigurationError);
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

async function startTestServer(): Promise<TestServer> {
  const config = { host: "127.0.0.1", port: 0, token: VALID_TOKEN_32 };
  const runtime = createHttpServer(config);
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
});
