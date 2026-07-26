import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HTTP_DEFAULTS, MIN_TOKEN_LENGTH } from "../../src/http/config.js";
import { createHttpServer, listen, type HttpRuntime } from "../../src/http/server.js";
import { TokenStore } from "../../src/http/token-store.js";

const SHARED_TOKEN = "a".repeat(MIN_TOKEN_LENGTH);

// An options object rather than a defaulted parameter: passing `undefined`
// positionally would select the default and silently keep the shared token.
async function startServer(
  overrides: { sharedToken: string | undefined } = { sharedToken: SHARED_TOKEN },
): Promise<{ runtime: HttpRuntime; origin: string }> {
  const path = join(mkdtempSync(join(tmpdir(), "deeptrace-issue-")), "tokens.json");
  const config = { ...HTTP_DEFAULTS, host: "127.0.0.1", port: 0, ...overrides };
  const runtime = createHttpServer(config, { tokenStore: new TokenStore(path) });
  await listen(runtime, config);
  const address = runtime.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a port");
  }
  return { runtime, origin: `http://127.0.0.1:${address.port}` };
}

function extractToken(body: string): string {
  return /dt_[A-Za-z0-9_-]+/u.exec(body)?.[0] ?? "";
}

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

  it("keeps serving clients with the shared token retired", async () => {
    const { runtime, origin } = await startServer({ sharedToken: undefined });
    try {
      const token = extractToken(await (await fetch(`${origin}/auth`, { method: "POST" })).text());

      // The migration ends here: a self-serve token is the whole credential,
      // and the shared one that used to open every door no longer does.
      const accepted = await fetch(origin, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const retired = await fetch(origin, {
        method: "POST",
        headers: { authorization: `Bearer ${SHARED_TOKEN}` },
      });

      expect(accepted.status).not.toBe(401);
      expect(retired.status).toBe(401);
      await accepted.text();
      await retired.text();
    } finally {
      await runtime.close();
    }
  });

  it("accepts the form post a browser actually sends", async () => {
    const { runtime, origin } = await startServer();
    try {
      // A real submission carries Origin and a form content type; the plain
      // fetch the other tests use sends neither.
      const response = await fetch(`${origin}/auth`, {
        method: "POST",
        headers: {
          origin: "https://mcp.ikodo.dev",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "",
      });

      expect(response.status).toBe(201);
      expect(extractToken(await response.text())).not.toBe("");
    } finally {
      await runtime.close();
    }
  });

  it("keeps the issued token blurred until the reader asks for it", async () => {
    const { runtime, origin } = await startServer();
    try {
      const body = await (await fetch(`${origin}/auth`, { method: "POST" })).text();

      // Blur is presentation only. The value must stay selectable underneath,
      // or the click-then-copy path this page documents stops working, and it
      // must stay script-free so the page keeps its own CSP.
      expect(body).toContain('class="token secret"');
      expect(body).toContain("filter:blur(");
      expect(body).toContain("user-select:all");
      expect(body).toMatch(/\.token\.secret:hover[^{]*\{filter:none\}/u);
      expect(body).not.toMatch(/<script/u);
      expect(extractToken(body)).not.toBe("");
    } finally {
      await runtime.close();
    }
  });

  it("does not set a referrer policy that nulls its own form's origin", async () => {
    const { runtime, origin } = await startServer();
    try {
      // `no-referrer` is the one policy that makes a browser send
      // `Origin: null`, and the allowlist refuses that value. Setting it here
      // means the page rejects the only form it serves, which no test using an
      // explicit origin can catch.
      const page = await fetch(`${origin}/auth`);
      expect(page.headers.get("referrer-policy")).not.toBe("no-referrer");
      await page.text();

      const nulled = await fetch(`${origin}/auth`, {
        method: "POST",
        headers: { origin: "null", "content-type": "application/x-www-form-urlencoded" },
        body: "",
      });

      expect(nulled.status).toBe(403);
      await nulled.text();
    } finally {
      await runtime.close();
    }
  });

  it("refuses a mint posted from another site", async () => {
    const { runtime, origin } = await startServer();
    try {
      const response = await fetch(`${origin}/auth`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(/dt_/u);
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

  it("keeps minting for one address without capping it", async () => {
    const { runtime, origin } = await startServer();
    try {
      const statuses: number[] = [];
      const tokens = new Set<string>();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(`${origin}/auth`, {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.7" },
        });
        statuses.push(response.status);
        tokens.add(extractToken(await response.text()));
      }

      // A cap here only ever blocked someone reconnecting: a token grants
      // nothing they could not obtain by asking again from another address.
      expect(statuses).toEqual([201, 201, 201, 201, 201, 201]);
      expect(tokens.size).toBe(6);
    } finally {
      await runtime.close();
    }
  });
});
