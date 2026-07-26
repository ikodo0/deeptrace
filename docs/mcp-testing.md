# MCP server testing guide

This document explains how to run the DeepTrace MCP server and how to confirm it
answers a real tool call. It covers the local stdio and HTTP transports, the
public MCP gateway, its private Nuthatch source, and the operations needed on
container CT 104. It is written for someone who has never run this repo before.

The single most important boundary is that MCP clients call only
`https://mcp.ikodo.dev`. Nuthatch is an internal source called by the DeepTrace
server; it is never exposed to an end user's machine.

## Two surfaces

There are two HTTP services, but only the DeepTrace MCP gateway is public:

| Surface | URL | Backs onto | Who calls it |
| --- | --- | --- | --- |
| DeepTrace MCP gateway | `https://mcp.ikodo.dev` | `127.0.0.1:8787` | MCP clients |
| Nuthatch source API | `http://127.0.0.1:8288` | co-located Nuthatch service | the DeepTrace server only |

The root URL is canonical. `/mcp` remains a legacy compatibility alias for
already configured clients. Routes such as `/health`, `/ready`, `/nest`,
`/schema`, and `/sql` belong to Nuthatch and are intentionally unavailable on
the public hostname.

## For an external collaborator

This is the whole path for someone who only needs to call the tool. You do not
need Tailscale, a repo checkout, a local build, Graph credentials, or direct
Nuthatch access.

### What you need from the maintainer

1. The gateway URL: `https://mcp.ikodo.dev`
2. A bearer token sent through a secure channel

Keep the token in the client's secret store or an environment variable. Never
put it in a URL, prompt, shell history, repository, or log.

### Setup

Register the public server with a client that accepts HTTP MCP headers. For
example, Claude Code can keep only an environment-variable reference in
`.mcp.json`:

```json
{
  "mcpServers": {
    "deeptrace": {
      "type": "http",
      "url": "https://mcp.ikodo.dev",
      "headers": {
        "Authorization": "Bearer ${DEEPTRACE_TOKEN}"
      },
      "alwaysLoad": true
    }
  }
}
```

Read the secret without placing it in shell history, launch the client from the
same shell, and confirm it connected:

```
read -rsp "DeepTrace bearer token: " DEEPTRACE_TOKEN && echo
export DEEPTRACE_TOKEN
claude mcp list         # expect: deeptrace: ... (HTTP) - ✔ Connected
```

### First call

Ask the agent to compare Base WETH/USDC pools, or call the `compare_pools`
tool with `chain_id` `8453`, `token0`
`0x4200000000000000000000000000000000000006` and `token1`
`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`. A healthy production result has
status `complete`, successful Graph coverage, and
`nuthatch_available: true`. A `partial` result is still a valid response when a
source is temporarily stale or unavailable; inspect its warnings and
provenance rather than inventing missing values.

For swap history, call `find_large_swaps` with chain `8453`, pool
`0x6c561b446416e1a00e8e93e221854d6ea4171372`, WETH or native USDC as
`threshold_token`, and a positive human-unit `min_amount`. A healthy result is
`complete`; continue only by copying its opaque `next_cursor` into the same
request scope. This tool does not calculate USD notional.

### If it does not work — report back which one

| You see | What it means |
| --- | --- |
| DNS, TLS, or timeout error | The public network path is unavailable. Confirm the hostname is exactly `mcp.ikodo.dev`; no Tailscale hostname is needed. |
| HTTP 401 | You reached the server; the token is wrong or stale. Ask for a reissue. |
| HTTP 404 | Use `https://mcp.ikodo.dev`; `/mcp` is supported only as a legacy alias. Do not append Nuthatch routes. |
| Connected but a source is partial | Read the returned source warnings and provenance; client connectivity succeeded. |

Nothing here needs repo access, a Graph API key, or a local build.

## Prerequisites

Node >= 22. CT 104 runs v22.23.1.

Environment variables. The app never reads `.env`, so export them in the
shell or systemd unit that starts the server.

| Variable | Purpose |
| --- | --- |
| `DEEPTRACE_HTTP_TOKEN` | Required for the HTTP transport. Minimum 32 characters. Startup fails otherwise. |
| `DEEPTRACE_HTTP_PORT` | Default `8787`. |
| `DEEPTRACE_HTTP_HOST` | Default `127.0.0.1`. |
| `DEEPTRACE_HTTP_SESSION_IDLE_TIMEOUT_MS` | Idle session lifetime. Default `1800000` (30 minutes). |
| `DEEPTRACE_HTTP_SESSION_SWEEP_INTERVAL_MS` | Idle-session cleanup cadence. Default `60000` (1 minute). |
| `GRAPH_API_KEY` | Required, or every Graph source returns `unavailable`. |
| `NUTHATCH_BASE_URL` | Production: `http://127.0.0.1:8288`, no trailing slash. |

Authenticated session requests refresh activity, and in-flight tool calls are
not reaped. A standalone SSE stream does not keep an otherwise-idle session
alive forever. A session that remains inactive for the full idle timeout is
closed on the next cleanup sweep, releasing its slot in the 64-session process
limit.

## Build

```
npm ci
npm run build
```

`npm run build` is `tsc && node scripts/copy-build-assets.mjs`. The second step
copies `src/**/*.json` into `dist/`. It is not optional: `src/registry/index.ts`
resolves `records.json` relative to the compiled module, so without it every
`compare_pools` call fails with
`Invalid registry configuration: records.json: could not be read`.

## Run it locally

### stdio

This is the default for local Claude Code.

```
node dist/index.js
```

Verified handshake, three JSON-RPC lines on stdin:

```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

Verified reply to `initialize`:

```
{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"deeptrace","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
```

### HTTP

```
DEEPTRACE_HTTP_TOKEN=<TOKEN> DEEPTRACE_HTTP_PORT=8799 node dist/http.js
```

Logs:

```
[deeptrace] MCP HTTP transport listening on 127.0.0.1:8799
```

## Test the HTTP transport

### Fast path: the smoke script

One command runs the whole handshake and prints a result per step. Use this
first; drop to the manual steps below only when something fails and you need to
see the raw exchange.

```
read -rsp "DeepTrace bearer token: " DEEPTRACE_HTTP_TOKEN && echo
export DEEPTRACE_HTTP_TOKEN
DEEPTRACE_MCP_URL=https://mcp.ikodo.dev npm run smoke:mcp
```

```
auth gate (no token)         PASS  status=401 (expected 401)
unknown path                 PASS  status=404 (expected 404)
initialize                   PASS  status=200 session=established
notifications/initialized    PASS  status=202 (expected 202)
tools/list                   PASS  tools=[compare_pools,find_large_swaps]
tools/call compare_pools     PASS  status=complete 2/2
tools/call find_large_swaps  PASS  status=complete 1/1
7 passed, 0 failed
```

Both variables are required; missing ones are reported by name only. The exit
code is 0 only when every check passes, so it works unchanged in CI or a
post-deploy hook. Export `DEEPTRACE_HTTP_TOKEN` from a secure prompt or secret
manager rather than writing a real value into this command. Point
`DEEPTRACE_MCP_URL` at `http://127.0.0.1:8787` to check a local instance
instead. The legacy `https://mcp.ikodo.dev/mcp` and
`http://127.0.0.1:8787/mcp` aliases remain available to existing
configurations. After a successful initialize, the script always makes a
best-effort authenticated `DELETE` to close the Streamable HTTP session,
including when a later check fails. Tokens and session IDs are never printed.

For `compare_pools`, both `complete` and `partial` prove that the call
completed. The LSS smoke check requires `find_large_swaps` to be `complete`
with 1/1 source coverage. A production `compare_pools` call normally returns
`complete`; its `partial` status means at least one upstream source was stale or
unavailable and must be explained from the returned warnings.
`find_large_swaps` has no partial status: an unavailable sole source is
`failed`.

### Manual path

The HTTP handshake is four steps followed by session cleanup. Skipping step 2
or the negotiated protocol-version header is the usual mistake.

Streamable HTTP requires both content types in `Accept`:

```
Accept: application/json, text/event-stream
```

Responses come back as SSE frames prefixed with `data: `.

### Step 1 — initialize

The session id comes back in the `mcp-session-id` header.

```
SID=$(curl -sS -D - -o /dev/null -X POST http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  | tr -d '\r' | awk -F': ' '/^mcp-session-id/{print $2}')
```

### Step 2 — initialized notification

Returns HTTP 202. Requests sent before this are rejected.

```
curl -sS -X POST http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

### Step 3 — tools/list

Verified to return exactly two tools, `compare_pools` and
`find_large_swaps`.

```
curl -sS -X POST http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### Step 4 — tools/call

Arguments are locked by the schema: `chain_id` must be `8453`, `token0` must be
the WETH address, `token1` the native USDC address. `window` is `"24h"` or
`"7d"`. `ranked_by` is `"tvl_usd"`, `"volume_usd"` or `"fees_usd"`. `top_n`
1..3.

```
curl -sS --max-time 90 -X POST http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compare_pools","arguments":{"chain_id":8453,"token0":"0x4200000000000000000000000000000000000006","token1":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","window":"24h","ranked_by":"tvl_usd"}}}'
```

Verified result today (values change; shape does not):

```
status: complete
coverage: {"requested_deployments":2,"successful_deployments":2,"nuthatch_available":true}
pool 0x6c561b44... tvl 151138739.377709
pool 0x72ab388e... tvl 6612457.78705088
```

The specific values, freshness block, and status may change. If the result is
`partial`, use its warnings and per-source provenance to identify the degraded
source.

Call the released large-swap tool in the same session:

```
curl -sS --max-time 90 -X POST http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"find_large_swaps","arguments":{"chain_id":8453,"pool_address":"0x6c561b446416e1a00e8e93e221854d6ea4171372","threshold_token":"0x4200000000000000000000000000000000000006","min_amount":"1","limit":1}}}'
```

`complete` may contain zero matches. `failed` means the sole Nuthatch swap
source could not prove a stable fresh page; inspect warnings and do not invent
a fallback. The requested limit is a cap: the server may return a shorter page
with `has_more` and a warning to remain within the 64 KiB response budget.

### Cleanup — close the session

Close the Streamable HTTP session even when a later check fails:

```
curl -sS -X DELETE http://127.0.0.1:8799 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "mcp-session-id: $SID" \
  -H "MCP-Protocol-Version: 2025-06-18"
```

## Connect a client

Use `https://mcp.ikodo.dev` plus an environment-backed bearer token. See
[`docs/connect.md`](connect.md) for tested Claude Code, OpenCode, and Codex
configuration examples. Nuthatch is not a second client connection.

For Claude Code, `claude mcp list` should print
`deeptrace: ... (HTTP) - ✔ Connected`.

Remove with:

```
claude mcp remove deeptrace
```

## Verify the Nuthatch source

Run these checks on CT 104 with
`NUTHATCH_BASE_URL=http://127.0.0.1:8288`. Production DeepTrace uses this
co-located loopback URL, so Nuthatch remains unavailable from the public
internet. An operator may also use the separately restricted tailnet Serve
endpoint to diagnose Nuthatch itself, but it is not an MCP client URL and is not
part of normal request routing.

Three checks pass on a healthy deployment.

### 1. /ready

```
curl -sS $NUTHATCH_BASE_URL/ready
```

Verified:

```
{"lag_blocks":45848,"ready":true,"sealed_through":49065709,"stalled":false,"tip":49111557}
```

`200` means ready. `503` maps to status `stale` in the adapter.
For operations, HTTP 200 is not sufficient: compare `last_block` (or
`sealed_through` on Nuthatch 0.6.1) across polls. The committed watchdog does
this independently of the unreliable `stalled` field.

### 2. /nest

```
curl -sS $NUTHATCH_BASE_URL/nest
```

`registry_hash` must equal the registry's `deployment_or_view_id`:

```
0x46e57ffd7f6fb47e80c49314a5522bd588fd8f6ba2194528bd560be10d78da25
```

Verified: matches.

### 3. /sql

```
curl -sS -G --data-urlencode "q=SELECT * FROM pool_swap_freshness LIMIT 1" \
  --data-urlencode "max_rows=1" $NUTHATCH_BASE_URL/sql
```

Verified: one row, shape
`{"count":1,"provenance":{...},"rows":[{...}],"truncated":false}`.

Row fields: `pool_address`, `recent_swap_count_24h`, `last_swap_block`,
`last_swap_block_timestamp`, `last_swap_log_index`, `last_swap_block_hash`,
`last_swap_tx_hash`.

The LSS deployment additionally requires `pool_swap_search`:

```
curl -sS -G --data-urlencode \
  "q=SELECT * FROM pool_swap_search ORDER BY block_number DESC, log_index DESC LIMIT 1" \
  --data-urlencode "max_rows=1" $NUTHATCH_BASE_URL/sql
```

Its receipt must contain the locked pool address, block number/hash/timestamp,
transaction hash, log index, and exact signed `amount0_raw`/`amount1_raw`.
Run the committed `swap_search_parity` nest check before accepting a new nest
bundle.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Public URL times out or does not resolve | Confirm the URL is exactly `https://mcp.ikodo.dev` and test public DNS/TLS. A normal user does not need Tailscale. |
| HTTP 401 | Wrong or missing bearer token. The network path is fine — 401 means the server was reached. |
| HTTP 403 `invalid_origin` | A browser or proxy sent an untrusted `Origin`. Native MCP clients normally omit it; browser-based requests must use `https://mcp.ikodo.dev`. |
| HTTP 404 on `/health` or `/ready` | These are private Nuthatch routes, not public MCP routes. Use the MCP root URL; operators run Nuthatch probes on CT 104 loopback. |
| HTTP 400 `missing_session` | `tools/*` sent without the `mcp-session-id` header, or before the `initialized` notification. |
| Server exits at startup | `DEEPTRACE_HTTP_TOKEN` missing or shorter than 32 characters. |
| `records.json could not be read` | Built with bare `tsc`. Re-run `npm run build`. |
| All sources `unavailable` | `GRAPH_API_KEY` not set in the server's environment. |
| Graph succeeds but Nuthatch is unavailable | Confirm `NUTHATCH_BASE_URL=http://127.0.0.1:8288`, then probe `/ready` locally and inspect `nuthatch.service`. Do not replace loopback with the tailnet hostname. |
| Internal tailnet diagnostic times out | The restricted Tailscale Serve path or ACL identity may be wrong. Test loopback first; this does not affect what URL an MCP user should configure. |
| Connected but zero tools | A stale build is deployed. Rebuild and restart. |

For an internal tailnet diagnostic, ACL denials can look like timeouts. Check
the same Nuthatch route on `127.0.0.1:8288` before concluding the service is
down. Never ask an external MCP user to join the tailnet as a workaround.

## CT 104 operations

Service: `deeptrace-http.service`, `User=deploy`,
`WorkingDirectory=/opt/deeptrace`, `ExecStart=/usr/bin/node dist/http.js`,
`EnvironmentFile=/etc/deeptrace/http.env` (root:root, 0600, holds
`DEEPTRACE_HTTP_TOKEN`, `GRAPH_API_KEY`, `NUTHATCH_BASE_URL`).
Production sets `NUTHATCH_BASE_URL=http://127.0.0.1:8288`; the public proxy
routes only to the DeepTrace HTTP service.

Access is via the Proxmox host; there is no direct SSH into the container:

```
ssh root@pve 'pct exec 104 -- systemctl status deeptrace-http.service'
ssh root@pve 'pct exec 104 -- journalctl -u deeptrace-http.service -n 50'
ssh root@pve 'pct exec 104 -- systemctl restart deeptrace-http.service'
```

Autodeploy: `deeptrace-pull-deploy.timer` fires every 60s, polls
`origin/develop`, rsyncs to `/opt/deeptrace`, runs `npm ci` and
`npm run build`, then restarts `deeptrace-http.service`. `dist/` and
`node_modules/` are excluded from the rsync `--delete` because they are build
products absent from the git tree; without those excludes a deploy deletes the
running app's runtime.

Force a deploy:

```
ssh root@pve 'pct exec 104 -- systemctl start deeptrace-pull-deploy.service'
```

Nuthatch loads its ordered RPC fallbacks from the root-owned
`/etc/default/nuthatch`. Configure independent providers in
`BASE_RPC_URL_PRIMARY`, `BASE_RPC_URL_SECONDARY`, and
`BASE_RPC_URL_TERTIARY`; the service passes them as repeatable `--rpc`
arguments before the credential-free committed fallbacks. Never put keyed RPC
URLs in this document, the repository, probe output, or support logs.

Rotate the MCP token:

```
ssh root@pve 'pct exec 104 -- bash -c "openssl rand -hex 32 > /etc/deeptrace/token"'
```

Then update `DEEPTRACE_HTTP_TOKEN` in `/etc/deeptrace/http.env`, restart the
service, and reissue the token to every client.

## Known gaps

1. Nuthatch can temporarily trail the chain tip during backfill or an RPC
   outage. `nuthatch-watchdog.timer` detects ten minutes without indexed-block
   progress and emits a structured alert; see `docs/deployment.md` for the
   report-only recovery procedure. `compare_pools` invokes the live freshness
   adapter and truthfully reports that source as stale or unavailable until it
   catches up, producing a `partial` `compare_pools` result and a `failed`
   `find_large_swaps` result rather than hiding the gap.
2. The automated test suite remains offline. Operators run `npm run smoke:mcp`
   against the public URL as the post-deploy live integration check.
