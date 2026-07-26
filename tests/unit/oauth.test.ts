import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HTTP_DEFAULTS, MIN_TOKEN_LENGTH } from "../../src/http/config.js";
import { resetOAuthState } from "../../src/http/oauth.js";
import { createHttpServer, listen, type HttpRuntime } from "../../src/http/server.js";
import { TokenStore } from "../../src/http/token-store.js";

const SHARED_TOKEN = "a".repeat(MIN_TOKEN_LENGTH);
const CALLBACK = "http://127.0.0.1:53211/callback";

async function startServer(): Promise<{ runtime: HttpRuntime; origin: string }> {
  const config = { ...HTTP_DEFAULTS, host: "127.0.0.1", port: 0, token: SHARED_TOKEN };
  const path = join(mkdtempSync(join(tmpdir(), "deeptrace-oauth-")), "tokens.json");
  const runtime = createHttpServer(config, { tokenStore: new TokenStore(path) });
  await listen(runtime, config);
  const address = runtime.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a port");
  }
  return { runtime, origin: `http://127.0.0.1:${address.port}` };
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier, "utf8").digest("base64url"),
  };
}

async function register(
  origin: string,
  redirectUri = CALLBACK,
  sentOrigin?: string,
): Promise<Response> {
  return fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sentOrigin === undefined ? {} : { origin: sentOrigin }),
    },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Test Client" }),
  });
}

afterEach(() => {
  resetOAuthState();
});

describe("OAuth browser flow", () => {
  it("advertises the flow on an unauthenticated MCP request", async () => {
    const { runtime, origin } = await startServer();
    try {
      const response = await fetch(origin, { method: "POST" });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://mcp.ikodo.dev/.well-known/oauth-protected-resource"',
      );
      await response.text();
    } finally {
      await runtime.close();
    }
  });

  it("publishes both discovery documents", async () => {
    const { runtime, origin } = await startServer();
    try {
      const resource = (await (
        await fetch(`${origin}/.well-known/oauth-protected-resource`)
      ).json()) as Record<string, unknown>;
      const server = (await (
        await fetch(`${origin}/.well-known/oauth-authorization-server`)
      ).json()) as Record<string, unknown>;

      expect(resource.authorization_servers).toEqual(["https://mcp.ikodo.dev"]);
      expect(server.code_challenge_methods_supported).toEqual(["S256"]);
      expect(server.grant_types_supported).toEqual(["authorization_code"]);
      expect(server.token_endpoint).toBe("https://mcp.ikodo.dev/oauth/token");
    } finally {
      await runtime.close();
    }
  });

  it("registers a client that calls back to loopback", async () => {
    const { runtime, origin } = await startServer();
    try {
      const body = (await (await register(origin)).json()) as Record<string, unknown>;

      expect(body.client_id).toEqual(expect.any(String));
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body).not.toHaveProperty("client_secret");
    } finally {
      await runtime.close();
    }
  });

  it("refuses to register a callback that leaves this machine", async () => {
    const { runtime, origin } = await startServer();
    try {
      const response = await register(origin, "https://evil.example/callback");

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    } finally {
      await runtime.close();
    }
  });

  it("carries a client all the way from consent to a working token", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const { verifier, challenge } = pkce();

      const authorize = new URL(`${origin}/oauth/authorize`);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", client_id);
      authorize.searchParams.set("redirect_uri", CALLBACK);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      authorize.searchParams.set("state", "xyz");

      const consent = await fetch(authorize);
      const html = await consent.text();
      expect(consent.status).toBe(200);
      expect(html).toContain("Test Client");
      expect(html).toContain("Approve");
      expect(html).not.toMatch(/<script/u);

      // Approving redirects the browser to the client's own callback.
      const approved = await fetch(`${origin}/oauth/authorize`, {
        method: "POST",
        headers: {
          origin: "https://mcp.ikodo.dev",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id,
          redirect_uri: CALLBACK,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz",
        }),
        redirect: "manual",
      });
      expect(approved.status).toBe(302);
      const location = new URL(approved.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe(CALLBACK);
      expect(location.searchParams.get("state")).toBe("xyz");
      const code = location.searchParams.get("code") ?? "";
      expect(code).not.toBe("");

      const exchanged = await fetch(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id,
          redirect_uri: CALLBACK,
          code_verifier: verifier,
        }),
      });
      const token = (await exchanged.json()) as { access_token: string; token_type: string };
      expect(exchanged.status).toBe(200);
      expect(token.token_type).toBe("Bearer");
      expect(token.access_token.startsWith("dt_")).toBe(true);

      // The whole point: that token authenticates MCP with nothing copied.
      const anonymous = await fetch(origin, { method: "POST" });
      const authorized = await fetch(origin, {
        method: "POST",
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      expect(anonymous.status).toBe(401);
      expect(authorized.status).not.toBe(401);
      await anonymous.text();
      await authorized.text();
    } finally {
      await runtime.close();
    }
  });

  it("serves client-to-server endpoints whatever origin the client sets", async () => {
    const { runtime, origin } = await startServer();
    try {
      // A CLI, an editor shell, or a loopback callback each send their own
      // origin. None can be enumerated, so none may be required.
      for (const sent of ["http://127.0.0.1:53211", "vscode-file://vscode-app", "null"]) {
        const discovery = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
          headers: { origin: sent },
        });
        expect(discovery.status).toBe(200);
        await discovery.text();

        const registered = await register(origin, CALLBACK, sent);
        expect(registered.status).toBe(201);
        await registered.text();

        const exchanged = await fetch(`${origin}/oauth/token`, {
          method: "POST",
          headers: { origin: sent, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: "nope" }),
        });
        // Reaching invalid_grant proves the origin check did not intercept it.
        expect(exchanged.status).toBe(400);
        expect(((await exchanged.json()) as { error: string }).error).toBe("invalid_grant");
      }
    } finally {
      await runtime.close();
    }
  });

  it("still refuses a consent submitted from another site", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const response = await fetch(`${origin}/oauth/authorize`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id,
          redirect_uri: CALLBACK,
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
        }),
        redirect: "manual",
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
      await response.text();
    } finally {
      await runtime.close();
    }
  });

  it("still refuses an MCP request from another site", async () => {
    const { runtime, origin } = await startServer();
    try {
      const response = await fetch(origin, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      });

      expect(response.status).toBe(403);
      await response.text();
    } finally {
      await runtime.close();
    }
  });

  it("rejects an exchange whose verifier does not match", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const { challenge } = pkce();

      const approved = await fetch(`${origin}/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id,
          redirect_uri: CALLBACK,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
        redirect: "manual",
      });
      const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code") ?? "";

      const exchanged = await fetch(`${origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id,
          redirect_uri: CALLBACK,
          code_verifier: pkce().verifier,
        }),
      });

      expect(exchanged.status).toBe(400);
      expect(((await exchanged.json()) as { error: string }).error).toBe("invalid_grant");
    } finally {
      await runtime.close();
    }
  });

  it("spends an authorization code exactly once", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const { verifier, challenge } = pkce();
      const approved = await fetch(`${origin}/oauth/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id,
          redirect_uri: CALLBACK,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
        redirect: "manual",
      });
      const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code") ?? "";
      const exchange = (): Promise<Response> =>
        fetch(`${origin}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id,
            redirect_uri: CALLBACK,
            code_verifier: verifier,
          }),
        });

      expect((await exchange()).status).toBe(200);
      expect((await exchange()).status).toBe(400);
    } finally {
      await runtime.close();
    }
  });

  it("never redirects to a callback it did not register", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const { challenge } = pkce();
      const authorize = new URL(`${origin}/oauth/authorize`);
      authorize.searchParams.set("client_id", client_id);
      authorize.searchParams.set("redirect_uri", "http://127.0.0.1:9/stolen");
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");

      const response = await fetch(authorize, { redirect: "manual" });

      // An open redirect here would hand the code to whoever asked for it.
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      await response.text();
    } finally {
      await runtime.close();
    }
  });

  it("requires PKCE with S256", async () => {
    const { runtime, origin } = await startServer();
    try {
      const { client_id } = (await (await register(origin)).json()) as { client_id: string };
      const authorize = new URL(`${origin}/oauth/authorize`);
      authorize.searchParams.set("client_id", client_id);
      authorize.searchParams.set("redirect_uri", CALLBACK);

      const response = await fetch(authorize, { redirect: "manual" });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("PKCE");
    } finally {
      await runtime.close();
    }
  });
});
