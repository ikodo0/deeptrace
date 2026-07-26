import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { loadGatewayConfig } from "../config/env.js";
import { FixedWindowRateLimiter } from "../gateway/index.js";
import { createMcpServer } from "../mcp/server.js";
import { createLiveComparePoolsSources } from "../tools/index.js";
import { isAuthorized } from "./auth.js";
import type { HttpConfig } from "./config.js";

/** Root is canonical; /mcp remains an alias for existing client configs. */
const MCP_PATHS = new Set(["/", "/mcp"]);
const SESSION_HEADER = "mcp-session-id";
/** Bounds memory held by abandoned sessions that never send DELETE. */
const MAX_SESSIONS = 64;

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly close: () => Promise<void>;
  activeRequests: number;
  lastActivityAt: number;
}

interface OpenedSession {
  readonly transport: StreamableHTTPServerTransport;
  /** True once onsessioninitialized registered the session in the map. */
  readonly wasRegistered: () => boolean;
  /** Marks the initialize request complete when it registered a session. */
  readonly finishRequest: () => void;
  /** Closes both the transport and the McpServer. Safe to call once. */
  readonly dispose: () => Promise<void>;
}

export interface HttpServerOptions {
  readonly now?: () => number;
  readonly scheduleSessionSweep?: (sweep: () => Promise<void>, intervalMs: number) => () => void;
}

export interface HttpRuntime {
  readonly server: Server;
  close(): Promise<void>;
}

function scheduleSessionSweep(sweep: () => Promise<void>, intervalMs: number): () => void {
  let sweepInProgress = false;
  const interval = setInterval(() => {
    if (sweepInProgress) {
      return;
    }
    sweepInProgress = true;
    void sweep()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown session cleanup error";
        console.error(`[deeptrace] Session cleanup failed: ${message}`);
      })
      .finally(() => {
        sweepInProgress = false;
      });
  }, intervalMs);
  interval.unref();
  return () => {
    clearInterval(interval);
  };
}

function respondJson(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { code, message } }));
}

function isBrowserNavigation(request: IncomingMessage): boolean {
  if (request.method !== "GET" || request.headers["sec-fetch-mode"] !== "navigate") {
    return false;
  }

  return (
    request.headers.accept
      ?.split(",")
      .some((value) => value.trim().split(";", 1)[0]?.toLowerCase() === "text/html") ?? false
  );
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Serves the MCP Streamable HTTP transport behind a bearer token.
 *
 * Each initialize request gets its own McpServer/transport pair keyed by
 * session id, so concurrent clients never share conversation state.
 */
export function createHttpServer(config: HttpConfig, options: HttpServerOptions = {}): HttpRuntime {
  const sessions = new Map<string, Session>();
  const pendingCloses = new Set<Promise<void>>();
  const now = options.now ?? Date.now;
  /** In-flight opens that have reserved a slot but not yet registered. */
  let pendingOpens = 0;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  // Built once per process, not once per session. A limiter constructed inside
  // createMcpServer would give every session its own private window, so the
  // configured ceiling would be multiplied by the number of live sessions
  // instead of protecting the upstream gateway. Loading the gateway config here
  // also fails fast at startup rather than per request.
  const gatewayConfig = loadGatewayConfig();
  const rateLimiter = new FixedWindowRateLimiter({
    maxRequests: gatewayConfig.rateLimitMaxRequests,
    windowMs: gatewayConfig.rateLimitWindowMs,
  });
  const sources = createLiveComparePoolsSources({
    timeoutMs: gatewayConfig.sourceTimeoutMs,
  });

  const closeSession = (sessionId: string, expectedSession?: Session): Promise<void> => {
    const session = sessions.get(sessionId);
    if (session === undefined || (expectedSession !== undefined && session !== expectedSession)) {
      return Promise.resolve();
    }
    sessions.delete(sessionId);
    const closePromise = session.close();
    pendingCloses.add(closePromise);
    void closePromise.then(
      () => {
        pendingCloses.delete(closePromise);
      },
      () => {
        pendingCloses.delete(closePromise);
      },
    );
    return closePromise;
  };

  const openSession = async (): Promise<OpenedSession> => {
    const mcpServer = createMcpServer({ gatewayConfig, rateLimiter, sources });
    let registeredSession: Session | undefined;
    let closePromise: Promise<void> | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        const session: Session = {
          transport,
          activeRequests: 1,
          lastActivityAt: now(),
          close: () => {
            closePromise ??= (async () => {
              try {
                await transport.close();
              } finally {
                await mcpServer.close();
              }
            })();
            return closePromise;
          },
        };
        registeredSession = session;
        sessions.set(sessionId, session);
        if (shuttingDown) {
          void closeSession(sessionId, session);
        }
      },
      onsessionclosed: (sessionId) => {
        void closeSession(sessionId).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown session cleanup error";
          console.error(`[deeptrace] Session cleanup failed: ${message}`);
        });
      },
    });

    // The SDK types onclose/onerror/onmessage as always-present accessors that
    // may hold undefined, while Transport declares them optional. Those differ
    // under exactOptionalPropertyTypes even though the runtime shape matches.
    await mcpServer.connect(transport as Transport);
    return {
      transport,
      wasRegistered: () => registeredSession !== undefined,
      finishRequest: () => {
        if (registeredSession !== undefined) {
          registeredSession.activeRequests -= 1;
          registeredSession.lastActivityAt = now();
        }
      },
      dispose: () => {
        closePromise ??= (async () => {
          try {
            await transport.close();
          } finally {
            await mcpServer.close();
          }
        })();
        return closePromise;
      },
    };
  };

  const sweepIdleSessions = async (): Promise<void> => {
    const sweepAt = now();
    const staleSessions = [...sessions.entries()].filter(
      ([, session]) =>
        session.activeRequests === 0 &&
        sweepAt - session.lastActivityAt >= config.sessionIdleTimeoutMs,
    );
    await Promise.all(
      staleSessions.map(([sessionId, session]) => closeSession(sessionId, session)),
    );
  };

  const cancelSessionSweep = (options.scheduleSessionSweep ?? scheduleSessionSweep)(
    sweepIdleSessions,
    config.sessionSweepIntervalMs,
  );

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (!MCP_PATHS.has(url.pathname)) {
          respondJson(response, 404, "not_found", "Unknown endpoint");
          return;
        }

        // A top-level browser visit cannot supply an MCP bearer token and
        // should not trigger the browser's native credential dialog. Keep this
        // branch narrow so programmatic MCP requests retain the auth challenge.
        if (isBrowserNavigation(request)) {
          respondJson(response, 404, "not_found", "This endpoint is available to MCP clients");
          return;
        }

        if (!isAuthorized(request.headers.authorization, config.token)) {
          response.setHeader("www-authenticate", 'Bearer realm="deeptrace"');
          respondJson(response, 401, "unauthorized", "Missing or invalid bearer token");
          return;
        }

        if (shuttingDown) {
          respondJson(response, 503, "shutting_down", "Server is shutting down");
          return;
        }

        const sessionId = request.headers[SESSION_HEADER];
        const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

        if (existing !== undefined) {
          // POST may contain long-running tool work and must not be reaped
          // mid-request. A standalone SSE GET is only activity when it starts;
          // otherwise an abandoned open stream could pin a session forever.
          const blocksIdleExpiration = request.method === "POST";
          if (blocksIdleExpiration) {
            existing.activeRequests += 1;
          }
          existing.lastActivityAt = now();
          try {
            await existing.transport.handleRequest(request, response);
          } finally {
            if (blocksIdleExpiration) {
              existing.activeRequests -= 1;
            }
            existing.lastActivityAt = now();
          }
          return;
        }

        if (request.method !== "POST") {
          respondJson(response, 400, "missing_session", "Unknown or missing session id");
          return;
        }

        const body = await readBody(request);
        if (!isInitializeRequest(body)) {
          respondJson(response, 400, "missing_session", "Unknown or missing session id");
          return;
        }

        if (sessions.size + pendingOpens >= MAX_SESSIONS) {
          respondJson(response, 503, "session_limit", "Too many active sessions");
          return;
        }

        pendingOpens += 1;
        try {
          const session = await openSession();
          try {
            await session.transport.handleRequest(request, response, body);
          } finally {
            session.finishRequest();
            if (!session.wasRegistered()) {
              await session.dispose();
            }
          }
        } finally {
          pendingOpens -= 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown request error";
        console.error(`[deeptrace] HTTP request failed: ${message}`);
        if (!response.headersSent) {
          respondJson(response, 500, "internal_error", "Request failed");
        } else {
          response.end();
        }
      }
    })();
  });

  return {
    server,
    close() {
      shutdownPromise ??= (async () => {
        shuttingDown = true;
        cancelSessionSweep();

        // Stop accepting connections immediately, then close both the sessions
        // already registered and any initialize request that finishes while
        // the HTTP server drains.
        const serverClose = new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) {
              resolve();
            } else {
              reject(error);
            }
          });
        });
        const failures: unknown[] = [];
        const settle = async (promises: readonly Promise<unknown>[]): Promise<void> => {
          const results = await Promise.allSettled(promises);
          for (const result of results) {
            if (result.status === "rejected") {
              failures.push(result.reason);
            }
          }
        };

        await settle([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
        await settle([serverClose]);
        await settle([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
        await settle([...pendingCloses]);

        if (failures.length > 0) {
          throw failures[0];
        }
      })();
      return shutdownPromise;
    },
  };
}

export function listen(runtime: HttpRuntime, config: HttpConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(config.port, config.host, () => {
      runtime.server.off("error", reject);
      resolve();
    });
  });
}
