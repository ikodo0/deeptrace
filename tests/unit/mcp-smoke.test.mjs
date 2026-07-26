import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

const TOKEN = "smoke-test-token-that-is-never-printed";
const SESSION_ID = "smoke-test-session-that-is-never-printed";
const PROTOCOL_VERSION = "2025-06-18";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function runSmoke(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/mcp-smoke.mjs"], {
      cwd: new URL("../..", import.meta.url),
      env: {
        ...process.env,
        DEEPTRACE_MCP_URL: url,
        DEEPTRACE_HTTP_TOKEN: TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

describe("MCP smoke session lifecycle", () => {
  it.each(["complete", "partial"])("accepts %s and cleans up", async (status) => {
    const deletes = [];
    const sessionRequests = [];
    const server = createServer((request, response) => {
      const authorized = request.headers.authorization === `Bearer ${TOKEN}`;

      if (request.method === "GET") {
        response.writeHead(404).end();
        return;
      }

      if (!authorized) {
        response.writeHead(401).end();
        return;
      }

      if (request.method === "DELETE") {
        deletes.push({
          authorization: request.headers.authorization,
          protocolVersion: request.headers["mcp-protocol-version"],
          sessionId: request.headers["mcp-session-id"],
        });
        response.writeHead(200).end();
        return;
      }

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const message = JSON.parse(body);

        if (message.method === "initialize") {
          const payload = {
            jsonrpc: "2.0",
            id: message.id,
            result: { protocolVersion: PROTOCOL_VERSION },
          };
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "mcp-session-id": SESSION_ID,
          });
          response.end(`data: ${JSON.stringify(payload)}\n\n`);
          return;
        }

        sessionRequests.push({
          method: message.method,
          protocolVersion: request.headers["mcp-protocol-version"],
        });

        if (message.method === "notifications/initialized") {
          response.writeHead(500).end();
          return;
        }

        if (message.method === "tools/list") {
          const payload = {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [{ name: "compare_pools" }, { name: "find_large_swaps" }],
            },
          };
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(`data: ${JSON.stringify(payload)}\n\n`);
          return;
        }

        const resultText =
          message.params?.name === "find_large_swaps"
            ? JSON.stringify({
                status: "complete",
                coverage: { successful_sources: 1, requested_sources: 1 },
              })
            : JSON.stringify({
                status,
                coverage: { successful_deployments: 2, requested_deployments: 2 },
              });
        const payload = {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: resultText }] },
        };
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify(payload)}\n\n`);
      });
    });
    await listen(server);
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind to a port");
    }

    const result = await runSmoke(`http://127.0.0.1:${address.port}/mcp`);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("notifications/initialized");
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toMatch(
      new RegExp(`tools/call compare_pools\\s+PASS\\s+status=${status} 2/2`),
    );
    expect(result.stdout).toMatch(/tools\/call find_large_swaps\s+PASS\s+status=complete 1\/1/);
    expect(sessionRequests).toEqual([
      { method: "notifications/initialized", protocolVersion: PROTOCOL_VERSION },
      { method: "tools/list", protocolVersion: PROTOCOL_VERSION },
      { method: "tools/call", protocolVersion: PROTOCOL_VERSION },
      { method: "tools/call", protocolVersion: PROTOCOL_VERSION },
    ]);
    expect(deletes).toEqual([
      {
        authorization: `Bearer ${TOKEN}`,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: SESSION_ID,
      },
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    expect(`${result.stdout}${result.stderr}`).not.toContain(SESSION_ID);
  });

  it("rejects an unsupported negotiated protocol version and still cleans up", async () => {
    const deletes = [];
    const unexpectedMethods = [];
    const server = createServer((request, response) => {
      const authorized = request.headers.authorization === `Bearer ${TOKEN}`;

      if (request.method === "GET") {
        response.writeHead(404).end();
        return;
      }
      if (!authorized) {
        response.writeHead(401).end();
        return;
      }
      if (request.method === "DELETE") {
        deletes.push({
          protocolVersion: request.headers["mcp-protocol-version"],
          sessionId: request.headers["mcp-session-id"],
        });
        response.writeHead(200).end();
        return;
      }

      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const message = JSON.parse(body);
        if (message.method !== "initialize") {
          unexpectedMethods.push(message.method);
          response.writeHead(500).end();
          return;
        }

        const payload = {
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2099-01-01" },
        };
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "mcp-session-id": SESSION_ID,
        });
        response.end(`data: ${JSON.stringify(payload)}\n\n`);
      });
    });
    await listen(server);
    servers.push(server);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server did not bind to a port");
    }

    const result = await runSmoke(`http://127.0.0.1:${address.port}/mcp`);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/initialize\s+FAIL\s+status=200 invalid protocolVersion/);
    expect(result.stdout).toContain("initialize failed; skipping remaining checks");
    expect(unexpectedMethods).toEqual([]);
    expect(deletes).toEqual([{ protocolVersion: PROTOCOL_VERSION, sessionId: SESSION_ID }]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
    expect(`${result.stdout}${result.stderr}`).not.toContain(SESSION_ID);
    expect(`${result.stdout}${result.stderr}`).not.toContain("2099-01-01");
  });
});
