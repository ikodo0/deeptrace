import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createMcpServer } from "../mcp/server.js";
import { isAuthorized } from "./auth.js";
import type { HttpConfig } from "./config.js";

const MCP_PATH = "/mcp";
const SESSION_HEADER = "mcp-session-id";
/** Bounds memory held by abandoned sessions that never send DELETE. */
const MAX_SESSIONS = 64;

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly close: () => Promise<void>;
}

interface OpenedSession {
  readonly transport: StreamableHTTPServerTransport;
  /** True once onsessioninitialized registered the session in the map. */
  readonly wasRegistered: () => boolean;
  /** Closes both the transport and the McpServer. Safe to call once. */
  readonly dispose: () => Promise<void>;
}

export interface HttpRuntime {
  readonly server: Server;
  close(): Promise<void>;
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
export function createHttpServer(config: HttpConfig): HttpRuntime {
  const sessions = new Map<string, Session>();
  /** In-flight opens that have reserved a slot but not yet registered. */
  let pendingOpens = 0;

  const closeSession = async (sessionId: string): Promise<void> => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    sessions.delete(sessionId);
    await session.close();
  };

  const openSession = async (): Promise<OpenedSession> => {
    const mcpServer = createMcpServer();
    let registered = false;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        registered = true;
        sessions.set(sessionId, {
          transport,
          close: async () => {
            await transport.close();
            await mcpServer.close();
          },
        });
      },
      onsessionclosed: (sessionId) => {
        void closeSession(sessionId);
      },
    });

    // The SDK types onclose/onerror/onmessage as always-present accessors that
    // may hold undefined, while Transport declares them optional. Those differ
    // under exactOptionalPropertyTypes even though the runtime shape matches.
    await mcpServer.connect(transport as Transport);
    return {
      transport,
      wasRegistered: () => registered,
      dispose: async () => {
        await transport.close();
        await mcpServer.close();
      },
    };
  };

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (url.pathname !== MCP_PATH) {
          respondJson(response, 404, "not_found", "Unknown endpoint");
          return;
        }

        if (!isAuthorized(request.headers.authorization, config.token)) {
          response.setHeader("www-authenticate", 'Bearer realm="deeptrace"');
          respondJson(response, 401, "unauthorized", "Missing or invalid bearer token");
          return;
        }

        const sessionId = request.headers[SESSION_HEADER];
        const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

        if (existing !== undefined) {
          await existing.transport.handleRequest(request, response);
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
        const session = await openSession();
        try {
          await session.transport.handleRequest(request, response, body);
        } finally {
          pendingOpens -= 1;
          if (!session.wasRegistered()) {
            await session.dispose();
          }
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
    async close() {
      await Promise.all([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
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
