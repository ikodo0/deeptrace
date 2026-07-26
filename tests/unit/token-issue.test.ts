import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HTTP_DEFAULTS, MIN_TOKEN_LENGTH } from "../../src/http/config.js";
import { createHttpServer, listen, type HttpRuntime } from "../../src/http/server.js";
import { resetIssueLimits } from "../../src/http/token-issue.js";
import { TokenStore } from "../../src/http/token-store.js";

const SHARED_TOKEN = "a".repeat(MIN_TOKEN_LENGTH);

async function startServer(): Promise<{ runtime: HttpRuntime; origin: string }> {
  const path = join(mkdtempSync(join(tmpdir(), "deeptrace-issue-")), "tokens.json");
  const runtime = createHttpServer(
    { ...HTTP_DEFAULTS, host: "127.0.0.1", port: 0, token: SHARED_TOKEN },
    { tokenStore: new TokenStore(path) },
  );
  await listen(runtime, { ...HTTP_DEFAULTS, host: "127.0.0.1", port: 0, token: SHARED_TOKEN });
  const address = runtime.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a port");
  }
  return { runtime, origin: `http://127.0.0.1:${address.port}` };
}

function extractToken(body: string): string {
  return /dt_[A-Za-z0-9_-]+/u.exec(body)?.[0] ?? "";
}

afterEach(() => {
  resetIssueLimits();
});

describe("self-serve token issuance", () => {
  it("offers a form without authentication", async () => {
    const { runtime, origin } = await startServer();
    try {
      const response = await fetch(`${origin}/auth`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(body).toContain('<form method="post" action="/auth">');
      expect(body).not.toMatch(/<script/u);
    } finally {
      await runtime.close();
    }
  });

  it("allows a form post only back to this origin", async () => {
    const { runtime, origin } = await startServer();
    try {
      const policy = (await fetch(`${origin}/auth`)).headers.get("content-security-policy") ?? "";

      expect(policy).toContain("form-action 'self'");
      expect(policy).toContain("script-src 'none'");
      expect(policy).toContain("default-src 'none'");
    } finally {
      await runtime.close();
    }
  });

  it("mints a token that authenticates an MCP request", async () => {
    const { runtime, origin } = await startServer();
    try {
      const issued = await fetch(`${origin}/auth`, { method: "POST" });
      const token = extractToken(await issued.text());

      expect(issued.status).toBe(201);
      expect(token).not.toBe("");

      // A minted token must clear the same gate the shared token clears.
      const rejected = await fetch(origin, { method: "POST" });
      const accepted = await fetch(origin, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(rejected.status).toBe(401);
      expect(accepted.status).not.toBe(401);
      await rejected.text();
      await accepted.text();
    } finally {
      await runtime.close();
    }
  });

  it("mints a different token for each caller", async () => {
    const { runtime, origin } = await startServer();
    try {
      const first = extractToken(await (await fetch(`${origin}/auth`, { method: "POST" })).text());
      const second = extractToken(await (await fetch(`${origin}/auth`, { method: "POST" })).text());

      expect(first).not.toBe(second);
    } finally {
      await runtime.close();
    }
  });

  it("stops one address minting without bound", async () => {
    const { runtime, origin } = await startServer();
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(`${origin}/auth`, {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.7" },
        });
        statuses.push(response.status);
        await response.text();
      }

      expect(statuses).toEqual([201, 201, 201, 429]);
    } finally {
      await runtime.close();
    }
  });

  it("counts each caller address separately", async () => {
    const { runtime, origin } = await startServer();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await (
          await fetch(`${origin}/auth`, {
            method: "POST",
            headers: { "cf-connecting-ip": "203.0.113.7" },
          })
        ).text();
      }
      const other = await fetch(`${origin}/auth`, {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.9" },
      });

      expect(other.status).toBe(201);
      await other.text();
    } finally {
      await runtime.close();
    }
  });
});
