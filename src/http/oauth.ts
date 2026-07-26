import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenStore } from "./token-store.js";

/**
 * OAuth 2.1 authorization code + PKCE, served from the resource server itself.
 *
 * Running both roles in one process removes the parts that usually make OAuth
 * expensive: there is no second host, no signing key, and no JWKS, because the
 * resource server can look an opaque token straight up in the token store
 * instead of verifying a signature. What it buys is the browser round trip —
 * clients open a page, approve, and receive the token themselves, so nobody
 * copies a secret by hand.
 */

const ISSUER = "https://mcp.ikodo.dev";
export const SCOPE = "deeptrace:read";

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
export const REGISTER_PATH = "/oauth/register";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/oauth/token";

/** An authorization code is redeemed seconds later, in one round trip. */
const CODE_TTL_MS = 60_000;

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

interface RegisteredClient {
  readonly redirectUris: readonly string[];
  readonly name: string;
}

interface PendingCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly expiresAt: number;
}

const clients = new Map<string, RegisteredClient>();
const codes = new Map<string, PendingCode>();

/**
 * Only loopback callbacks are accepted. A public client cannot keep a secret,
 * so the redirect target is the only thing binding a code to its requester —
 * an off-host URI would let a stranger's server receive the code.
 */
function isLoopbackRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

const STYLE = `<style>
@font-face{font-family:"NR";font-style:normal;font-weight:400;font-display:swap;src:url(/assets/text.woff2) format("woff2")}
@font-face{font-family:"PX";font-style:normal;font-weight:400;font-display:swap;src:url(/assets/mono.woff2) format("woff2")}
*,*::before,*::after{box-sizing:border-box}body,h1,p,form,ul{margin:0}
:root{--stock:#101219;--sheet:#171A23;--rule-2:#343949;--ink:#ECE6D9;--ink-2:#A2A7B4;--warn:#D99A3C;
--serif:"NR",Georgia,serif;--mono:"PX",ui-monospace,Menlo,monospace;color-scheme:dark}
html{background:var(--stock)}
body{background:var(--stock);color:var(--ink-2);font-family:var(--serif);font-optical-sizing:auto;
font-size:17px;line-height:1.62;-webkit-font-smoothing:antialiased}
.sheet{max-width:600px;margin:0 auto;padding:64px 20px 88px}
h1{font-weight:400;font-size:clamp(1.9rem,4.6vw,2.5rem);line-height:1.1;letter-spacing:-.012em;
color:var(--ink);margin-bottom:20px}
p{max-width:52ch;margin-bottom:18px}
b{color:var(--ink);font-weight:400;font-style:italic}
.who{border:1px solid var(--rule-2);background:var(--sheet);padding:16px 20px;margin-bottom:24px;
font-family:var(--mono);font-size:13px;color:var(--ink);word-break:break-all}
.who span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.18em;
color:var(--ink-2);margin-bottom:6px}
ul{list-style:none;margin-bottom:26px}
li{padding:7px 0;border-bottom:1px solid var(--rule-2);font-size:15px}
li::before{content:"\\2713";color:var(--ink);margin-right:10px}
li.no::before{content:"\\00D7";color:var(--warn)}
button{font-family:var(--mono);font-size:13px;color:var(--stock);background:var(--ink);border:0;
border-radius:2px;padding:12px 24px;cursor:pointer}
button:hover{filter:brightness(1.08)}
:focus-visible{outline:2px solid var(--warn);outline-offset:3px}
</style>`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${title}</title>${STYLE}</head>
<body><main class="sheet">${body}</main></body></html>
`;
}

function consentPage(clientName: string, hidden: string): string {
  return page(
    "Connect DeepTrace",
    `<h1>Connect DeepTrace</h1>
<div class="who"><span>Requesting access</span>${escapeHtml(clientName)}</div>
<p>This grants <b>read-only</b> pool research. Approving returns a token to the client
automatically &mdash; nothing to copy.</p>
<ul>
<li>Compare Base WETH/USDC pools</li>
<li>Search large swaps</li>
<li class="no">Cannot trade, sign, or send transactions</li>
<li class="no">Cannot read your files or your wallet</li>
</ul>
<form method="post" action="${AUTHORIZE_PATH}">${hidden}<button type="submit">Approve</button></form>`,
  );
}

function errorPage(message: string): string {
  return page("Cannot connect", `<h1>Cannot connect</h1><p>${escapeHtml(message)}</p>`);
}

function respondPage(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

export function isOAuthRequest(pathname: string): boolean {
  return (
    pathname === PROTECTED_RESOURCE_PATH ||
    pathname === AUTHORIZATION_SERVER_PATH ||
    pathname === REGISTER_PATH ||
    pathname === AUTHORIZE_PATH ||
    pathname === TOKEN_PATH
  );
}

/** Discovery, registration, consent, and redemption. All unauthenticated: a
 * client cannot present a token before this flow has issued one. */
export async function respondOAuth(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  store: TokenStore,
  now: () => number = Date.now,
): Promise<void> {
  const method = request.method ?? "GET";

  if (url.pathname === PROTECTED_RESOURCE_PATH) {
    json(response, 200, {
      resource: ISSUER,
      authorization_servers: [ISSUER],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
    return;
  }

  if (url.pathname === AUTHORIZATION_SERVER_PATH) {
    json(response, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}${AUTHORIZE_PATH}`,
      token_endpoint: `${ISSUER}${TOKEN_PATH}`,
      registration_endpoint: `${ISSUER}${REGISTER_PATH}`,
      scopes_supported: [SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    return;
  }

  // RFC 7591. MCP clients have no pre-issued client_id, so they register on
  // first contact. Public clients only: no secret is issued or accepted.
  if (url.pathname === REGISTER_PATH) {
    if (method !== "POST") {
      json(response, 405, { error: "invalid_request" });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    let metadata: { redirect_uris?: unknown; client_name?: unknown };
    try {
      metadata = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as typeof metadata;
    } catch {
      json(response, 400, { error: "invalid_client_metadata" });
      return;
    }
    const redirectUris = Array.isArray(metadata.redirect_uris)
      ? metadata.redirect_uris.filter(
          (value): value is string => typeof value === "string" && isLoopbackRedirect(value),
        )
      : [];
    if (redirectUris.length === 0) {
      json(response, 400, {
        error: "invalid_redirect_uri",
        error_description: "Only loopback redirect URIs are accepted",
      });
      return;
    }
    const clientId = randomUUID();
    clients.set(clientId, {
      redirectUris,
      name: typeof metadata.client_name === "string" ? metadata.client_name : "an MCP client",
    });
    json(response, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    return;
  }

  if (url.pathname === AUTHORIZE_PATH) {
    const parameters = method === "POST" ? await readForm(request) : url.searchParams;
    const clientId = parameters.get("client_id") ?? "";
    const redirectUri = parameters.get("redirect_uri") ?? "";
    const challenge = parameters.get("code_challenge") ?? "";
    const state = parameters.get("state") ?? "";
    const client = clients.get(clientId);

    // A bad redirect_uri can never be redirected to: doing so is the open
    // redirect. These failures render here instead.
    if (client === undefined || !client.redirectUris.includes(redirectUri)) {
      respondPage(response, 400, errorPage("This client or its callback is not recognised."));
      return;
    }
    if (parameters.get("code_challenge_method") !== "S256" || challenge === "") {
      respondPage(response, 400, errorPage("This client did not use PKCE with S256."));
      return;
    }

    if (method === "GET") {
      const hidden = (
        [
          ["client_id", clientId],
          ["redirect_uri", redirectUri],
          ["code_challenge", challenge],
          ["code_challenge_method", "S256"],
          ["state", state],
        ] as const
      )
        .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
        .join("");
      respondPage(response, 200, consentPage(client.name, hidden));
      return;
    }

    const code = randomUUID();
    codes.set(code, {
      clientId,
      redirectUri,
      challenge,
      expiresAt: now() + CODE_TTL_MS,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state !== "") {
      target.searchParams.set("state", state);
    }
    response.writeHead(302, { "cache-control": "no-store", location: target.toString() });
    response.end();
    return;
  }

  // TOKEN_PATH
  if (method !== "POST") {
    json(response, 405, { error: "invalid_request" });
    return;
  }
  const form = await readForm(request);
  const code = form.get("code") ?? "";
  const pending = codes.get(code);
  codes.delete(code); // single use, whether or not it validates

  if (
    form.get("grant_type") !== "authorization_code" ||
    pending === undefined ||
    pending.expiresAt < now() ||
    pending.clientId !== form.get("client_id") ||
    pending.redirectUri !== form.get("redirect_uri")
  ) {
    json(response, 400, { error: "invalid_grant" });
    return;
  }

  const verifier = form.get("code_verifier") ?? "";
  const computed = createHash("sha256").update(verifier, "utf8").digest("base64url");
  if (verifier === "" || computed !== pending.challenge) {
    json(response, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  json(response, 200, {
    access_token: store.mint(),
    token_type: "Bearer",
    scope: SCOPE,
  });
}

/** Test seam: registrations and codes are process-global. */
export function resetOAuthState(): void {
  clients.clear();
  codes.clear();
}
