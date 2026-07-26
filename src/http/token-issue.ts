import type { IncomingMessage, ServerResponse } from "node:http";

import type { TokenStore } from "./token-store.js";

export const ISSUE_PATH = "/auth";

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
/* The secret stays unreadable until asked for, so a screen share or a
   screenshot of the rest of the page does not carry it away. The blur is
   presentation only — the text underneath is still selectable, which is what
   lets one click select the whole value with no script on the page. */
.token.secret{filter:blur(5px);transition:filter .12s ease-out;cursor:pointer}
.token.secret:hover,.token.secret:focus,.token.secret:active{filter:none}
.token::selection{background:var(--warn);color:var(--stock)}
.hint{font-size:13px;margin:-18px 0 26px}
.hint kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--rule-2);border-radius:2px;
padding:1px 5px;color:var(--ink)}
@media (prefers-reduced-motion:reduce){.token.secret{transition:none}}
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

function issuedPage(token: string): string {
  return page(
    "Your DeepTrace token",
    `<h1>Your token</h1>
<div class="once"><b>Shown once</b>Copy it now. It is stored only as a hash, so it cannot be
shown again. Losing it costs nothing &mdash; come back and take another.</div>
<div class="token secret" tabindex="0">${token}</div>
<p class="hint">Blurred until you point at it. One click selects the whole token, then
<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd> copies it.</p>
<p>Export it, then follow the <a href="/">setup guide</a> for your client:</p>
<div class="token secret" tabindex="0">export DEEPTRACE_TOKEN=&quot;${token}&quot;</div>
<p>Never paste it into a chat, put it in a URL, or commit it.</p>`,
  );
}

export function isTokenIssueRequest(request: IncomingMessage, pathname: string): boolean {
  return (request.method === "GET" || request.method === "POST") && pathname === ISSUE_PATH;
}

/**
 * Minting is unmetered. Access is open by design, and a token grants nothing a
 * caller could not already take by asking again, so a per-address cap only ever
 * blocked legitimate reconnection. Spend is bounded where it is actually
 * incurred: the request rate limiter in front of the tools.
 */
export function respondTokenIssue(
  request: IncomingMessage,
  response: ServerResponse,
  store: TokenStore,
): void {
  if (request.method === "GET") {
    response.writeHead(200, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
    response.end(FORM_PAGE);
    return;
  }

  response.writeHead(201, { ...PAGE_HEADERS, "content-type": "text/html; charset=utf-8" });
  response.end(issuedPage(store.mint()));
}
