# Authentication

DeepTrace is a remote MCP server, so every request carries a bearer credential. This page
explains how a client gets one.

There is no account to create, no dashboard, and no maintainer to email. Access is open by
design: anyone who reaches the server can obtain a credential. What the credential protects
is not the data — the data is public on-chain information — but the metered Graph API quota
behind it. Rate limits exist as cost control, not as access control.

Think of the token as the plug rather than the lock. It identifies one client so that one
client can be revoked without disturbing anyone else.

## What you can do

- Connect any MCP-compatible client with one URL and one header
- Let a client register itself and complete the whole flow in a browser, with no token
  handling at all
- Mint a token yourself for CI, scripts, or clients that cannot open a browser
- Hold a separate credential per client, so losing one never affects the others

## The connection

Every harness accepts the same `key: value` pairs. Whatever client you use, these four
values are the entire configuration:

| Key | Value |
| --- | --- |
| Name | `deeptrace` |
| Transport | Streamable HTTP |
| URL | `https://mcp.ikodo.dev` |
| Header | `Authorization: Bearer <TOKEN>` |

Only the shape of the file differs between clients. The values never do. Per-client file
locations and formats are in [Connect an AI client](connect.md).

## Two ways in

### The browser flow

Clients that speak OAuth need no token from you. Point the client at the URL with no header
and it will report that authentication is required, then open a browser. You approve once,
and the client stores its own credential.

DeepTrace implements OAuth 2.1 authorization code with PKCE, served from the resource
server itself:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource` | Tells a client where the authorization server is |
| `/.well-known/oauth-authorization-server` | Advertises the endpoints and supported grants |
| `/oauth/register` | Dynamic client registration, RFC 7591 |
| `/oauth/authorize` | The consent page you approve |
| `/oauth/token` | Redeems the one-time code for a token |

The issued scope is `deeptrace:read`. Clients are public — no client secret is issued or
accepted — so PKCE with `S256` is mandatory and is the only thing proving that the client
redeeming a code is the one that requested it. A code is bound to its `client_id`,
`redirect_uri`, and PKCE challenge, all three rechecked at redemption, and it is valid once.
Replaying it returns `400`.

Redirect targets must be loopback. An off-host callback would let a stranger's server
receive the code, so `https:` and non-loopback `http:` are both refused.

### Minting a token directly

Open <https://mcp.ikodo.dev/auth> in a browser and press the button.

The endpoint is built for that page and always answers in HTML — `POST` mints and returns
`201` with the token in the page body; there is no JSON representation. A script therefore
has to scrape it:

```sh
TOKEN=$(curl -sS -X POST https://mcp.ikodo.dev/auth | grep -o 'dt_[A-Za-z0-9_-]\{20,\}' | head -1)
```

Minting is rate limited per caller address per hour. Exceeding it returns `429` with an HTML
page, and no `dt_` value, so a scrape like the one above yields an empty string rather than
an error — check that the token is non-empty before using it.

Tokens look like `dt_` followed by 32 random bytes in base64url. The server keeps only a
SHA-256 digest of each one, so the store holds no recoverable secret and lookup is by digest
rather than comparison. A token is shown once and cannot be recovered — mint a new one
instead, and reuse the one you have rather than minting per run.

## Handle the token safely

Read it without leaving a copy in shell history, then launch the client from that shell:

```sh
read -rsp "DeepTrace token: " DEEPTRACE_TOKEN
export DEEPTRACE_TOKEN
```

Reference the variable from the config file rather than pasting the value, which keeps the
file safe to commit. Never put a token in a URL, a chat message, or a support log. A
legitimate DeepTrace page will never ask you to type a token into it.

## Verify

```sh
claude mcp list
opencode mcp list
codex mcp list
```

A connected server that reports needing authentication has been reached successfully — that
is the browser flow waiting for you, not a failure.

## When something is wrong

| Symptom | Meaning |
| --- | --- |
| `401 Unauthorized` | Reached the server, but the credential is missing, invalid, or retired. The response carries `resource_metadata`, which is how a client finds the browser flow. |
| `404 Not Found` | Check the hostname is exactly `mcp.ikodo.dev`. |
| `invalid_redirect_uri` | The client asked for a callback the server will not accept. See the compatibility limits below. |
| `400` on token exchange | The code was already redeemed, or the `redirect_uri` or PKCE verifier does not match the request. |
| Client offers OAuth but never starts it | The client probed a discovery path this server does not answer. See below. |
| Connected, but results are `partial` | Not an auth problem. Read `warnings` and `coverage`; a data source is unavailable or stale. |

## Client compatibility limits

Claude Code has been verified end to end against production: registration, consent,
redirect, token exchange, and an MCP `initialize` returning `200` with a session id.

OpenCode and Codex are **not** verified end to end, and three known gaps in the current
implementation make failures likely rather than hypothetical:

- **Loopback is IPv4 only.** `isLoopbackRedirect` accepts `http:` with hostname `127.0.0.1`
  or `localhost`. An IPv6 callback on `[::1]`, or an RFC 8252 private-use scheme such as
  `cursor://`, is refused with `invalid_redirect_uri`.
- **Only two discovery paths are answered.** A client probing
  `/.well-known/openid-configuration`, or a variant with the MCP path appended, gets a miss
  and reasonably concludes the server offers no OAuth.
- **Registrations do not survive a restart.** The client registry is in-memory, and an
  unrecognised `client_id` is rejected at `/oauth/authorize`. Because a deploy restarts the
  service, a client that cached its `client_id` is stranded until it registers again.

Widening the accepted callbacks, answering the alias discovery paths, and tolerating an
unknown `client_id` when the callback is otherwise acceptable would close all three. The
last is safe because the code remains bound to `client_id`, `redirect_uri`, and the PKCE
challenge, all rechecked at exchange.

## For operators

The credential configuration lives in `/etc/deeptrace/http.env` (`root:root`, `0600`):

| Variable | Purpose |
| --- | --- |
| `DEEPTRACE_HTTP_TOKEN` | The shared deployment credential, kept only for migration |
| `DEEPTRACE_TOKEN_STORE` | Path to the issued-token store |

The issued-token store must live outside `/opt/deeptrace`, which the deploy rsyncs with
`--delete`; an in-repo default would be erased on every deploy. Production uses
`/var/lib/deeptrace/tokens.json`, mode `600`, owner `deploy`. Because the unit runs with
`ProtectSystem=strict`, a drop-in supplying `StateDirectory=deeptrace` and
`StateDirectoryMode=0700` is what creates that directory and punches it through the
hardening. Without it, minting fails with `EROFS`. See
[MCP testing](mcp-testing.md) under Issued token store.

Origin validation runs before routing, and is deliberately not enforced everywhere.
Discovery, registration, and token redemption are exempt, because clients set their own
`Origin` — a CLI, an editor shell, a loopback callback — and those values cannot be
enumerated. It is enforced on MCP paths and on `POST /oauth/authorize`.

### Retiring the shared token

`DEEPTRACE_HTTP_TOKEN` still authenticates every client at once. One leak exposes all of
them and cannot be revoked selectively, so retiring it is the highest-value remaining task.
Per-client issued tokens already make it unnecessary.

Retirement is an operational step, not a code change: remove the variable and restart. The
listener stays authenticated because issued tokens are unaffected. While the variable is
still set, the server logs a warning at startup naming it.

A value that is present but shorter than the minimum is still rejected as a
misconfiguration — a weak shared secret is worse than none.
