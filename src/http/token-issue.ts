import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenStore } from "./token-store.js";

export const ISSUE_PATH = "/auth";

/**
 * Access is open: anyone may take a token. The limit is therefore not an
 * access control but a cost control — it stops one caller minting an unbounded
 * number of credentials, each of which would spend metered Graph quota.
 */
const MINTS_PER_WINDOW = 3;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * The connection page forbids forms outright. This page needs exactly one, so
 * it carries its own policy with `form-action 'self'` and nothing else added.
 *
 * The referrer policy is `same-origin` rather than `no-referrer` because
 * `no-referrer` is the one policy that makes a browser send `Origin: null`.
 * This page's own form would then be rejected by the origin allowlist that
 * protects it. `same-origin` still sends nothing to other sites.
 */
const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const STYLE = `<style>
@font-face{font-family:"NR";font-style:normal;font-weight:400;font-display:swap;src:url(/assets/text.woff2) format("woff2")}
@font-face{font-family:"PX";font-style:normal;font-weight:400;font-display:swap;src:url(/assets/mono.woff2) format("woff2")}
*,*::before,*::after{box-sizing:border-box}body,h1,p,form{margin:0}
:root{--stock:#101219;--sheet:#171A23;--rule-2:#343949;--ink:#ECE6D9;--ink-2:#A2A7B4;--warn:#D99A3C;
--serif:"NR",Georgia,serif;--mono:"PX",ui-monospace,Menlo,monospace;color-scheme:dark}
html{background:var(--stock)}
body{background:var(--stock);color:var(--ink-2);font-family:var(--serif);font-optical-sizing:auto;
font-size:17px;line-height:1.62;-webkit-font-smoothing:antialiased}
.sheet{max-width:640px;margin:0 auto;padding:64px 20px 88px}
h1{font-weight:400;font-size:clamp(1.9rem,4.6vw,2.6rem);line-height:1.1;letter-spacing:-.012em;
color:var(--ink);margin-bottom:20px}
p{max-width:54ch;margin-bottom:18px}
b{color:var(--ink);font-weight:400;font-style:italic}
.mono{font-family:var(--mono);font-size:.84em;color:var(--ink)}
button{font-family:var(--mono);font-size:13px;color:var(--stock);background:var(--ink);border:0;
border-radius:2px;padding:12px 22px;cursor:pointer;margin-top:8px}
button:hover{filter:brightness(1.08)}
:focus-visible{outline:2px solid var(--warn);outline-offset:3px}
.token{margin:26px 0;border:1px solid var(--rule-2);background:var(--sheet);padding:18px 20px;
font-family:var(--mono);font-size:14px;color:var(--ink);word-break:break-all;user-select:all}
.once{border-left:2px solid var(--warn);background:color-mix(in srgb,var(--warn) 5%,var(--sheet));
padding:16px 20px;margin-bottom:26px}
.once b{display:block;font-family:var(--mono);font-size:10px;text-transform:uppercase;
letter-spacing:.18em;color:var(--warn);font-style:normal;margin-bottom:6px}
a{color:var(--ink-2)}
</style>`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${title}</title>${STYLE}</head>
<body><main class="sheet">${body}</main></body>
</html>
`;
}

const FORM_PAGE = page(
  "Get a DeepTrace token",
  `<h1>Get a token</h1>
<p>DeepTrace is read-only and open. Take a token, put it in your AI client, and start
comparing Base pools. <b>No wallet, no account, no email.</b></p>
<p>Your token is yours alone. If it leaks, only yours is revoked &mdash; everyone else keeps working.</p>
<form method="post" action="${ISSUE_PATH}"><button type="submit">Create a token</button></form>`,
);

const LIMIT_PAGE = page(
  "Too many tokens",
  `<h1>Slow down</h1>
<p>That is more tokens than this address needs in an hour. Reuse the one you have, or try
again later.</p>
<p><a href="/">Back to the setup guide</a></p>`,
);

function issuedPage(token: string): string {
  return page(
    "Your DeepTrace token",
    `<h1>Your token</h1>
<div class="once"><b>Shown once</b>Copy it now. It is stored only as a hash, so it cannot be
shown again. Losing it costs nothing &mdash; come back and take another.</div>
<div class="token">${token}</div>
<p>Export it, then follow the <a href="/">setup guide</a> for your client:</p>
<div class="token">export DEEPTRACE_TOKEN=&quot;${token}&quot;</div>
<p>Never paste it into a chat, put it in a URL, or commit it.</p>`,
  );
}

/** Fixed window keyed by caller address. Cleared lazily as windows lapse. */
const mints = new Map<string, { count: number; windowStart: number }>();

function withinLimit(address: string, now: number): boolean {
  const entry = mints.get(address);
  if (entry === undefined || now - entry.windowStart >= WINDOW_MS) {
    mints.set(address, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MINTS_PER_WINDOW) {
    return false;
  }
  entry.count += 1;
  return true;
}

/** Cloudflare terminates TLS, so the tunnel reports the real caller here. */
function callerAddress(request: IncomingMessage): string {
  const forwarded = request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() ?? request.socket.remoteAddress ?? "unknown";
}

export function isTokenIssueRequest(request: IncomingMessage, pathname: string): boolean {
  return (request.method === "GET" || request.method === "POST") && pathname === ISSUE_PATH;
}

export function respondTokenIssue(
  request: IncomingMessage,
  response: ServerResponse,
  store: TokenStore,
  now: () => number = Date.now,
): void {
  if (request.method === "GET") {
    response.writeHead(200, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
    response.end(FORM_PAGE);
    return;
  }

  if (!withinLimit(callerAddress(request), now())) {
    response.writeHead(429, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
    response.end(LIMIT_PAGE);
    return;
  }

  response.writeHead(201, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
  response.end(issuedPage(store.mint()));
}

/** Test seam: the mint window is process-global. */
export function resetIssueLimits(): void {
  mints.clear();
}
