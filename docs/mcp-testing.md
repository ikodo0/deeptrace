# MCP server testing guide

This document explains how to run the DeepTrace MCP server and how to confirm it
answers a real tool call. It covers the local stdio and HTTP transports, the
shared tailnet gateway, the Nuthatch source that sits behind it, and the
operations needed on container CT 104. It is written for someone who has never
run this repo before.

The single most common support issue is confusing the two HTTP surfaces on the
tailnet. Read "Two surfaces" before touching anything else.

## Two surfaces

There are two HTTP services exposed over Tailscale Serve on the same tailnet
host. They back onto different local ports and answer to different clients.
Mixing them up is the #1 support cost.

| Surface | URL | Backs onto | Who calls it |
| --- | --- | --- | --- |
| Nuthatch source API | https://wallet-intel.tail8ae57d.ts.net (:443) | 127.0.0.1:8288 | the DeepTrace Nuthatch adapter |
| DeepTrace MCP gateway | https://wallet-intel.tail8ae57d.ts.net:8443/mcp | 127.0.0.1:8787 | MCP clients (Claude Code etc.) |

Both are tailnet-only via Tailscale Serve. There is no Funnel.

The MCP gateway serves only the path `/mcp`. Everything else returns 404.
`/health`, `/ready`, `/nest`, `/schema`, `/sql` are Nuthatch routes on `:443`;
they do not exist on `:8443`.

## Prerequisites

Node >= 22. CT 104 runs v22.23.1.

Environment variables. The app never reads `.env`, so export them in the
shell or systemd unit that starts the server.

| Variable | Purpose |
| --- | --- |
| `DEEPTRACE_HTTP_TOKEN` | Required for the HTTP transport. Minimum 32 characters. Startup fails otherwise. |
| `DEEPTRACE_HTTP_PORT` | Default `8787`. |
| `DEEPTRACE_HTTP_HOST` | Default `127.0.0.1`. |
| `GRAPH_API_KEY` | Required, or every Graph source returns `unavailable`. |
| `NUTHATCH_BASE_URL` | `https://wallet-intel.tail8ae57d.ts.net`, no trailing slash. |

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

The HTTP handshake is four steps. Skipping step 2 is the usual mistake.

Streamable HTTP requires both content types in `Accept`:

```
Accept: application/json, text/event-stream
```

Responses come back as SSE frames prefixed with `data: `.

### Step 1 — initialize

The session id comes back in the `mcp-session-id` header.

```
SID=$(curl -sS -D - -o /dev/null -X POST http://127.0.0.1:8799/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  | tr -d '\r' | awk -F': ' '/^mcp-session-id/{print $2}')
```

### Step 2 — initialized notification

Returns HTTP 202. Requests sent before this are rejected.

```
curl -sS -X POST http://127.0.0.1:8799/mcp \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

### Step 3 — tools/list

Verified to return exactly one tool, `compare_pools`.

```
curl -sS -X POST http://127.0.0.1:8799/mcp \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### Step 4 — tools/call

Arguments are locked by the schema: `chain_id` must be `8453`, `token0` must be
the WETH address, `token1` the native USDC address. `window` is `"24h"` or
`"7d"`. `ranked_by` is `"tvl_usd"`, `"volume_usd"` or `"fees_usd"`. `top_n`
1..3.

```
curl -sS --max-time 90 -X POST http://127.0.0.1:8799/mcp \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compare_pools","arguments":{"chain_id":8453,"token0":"0x4200000000000000000000000000000000000006","token1":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","window":"24h","ranked_by":"tvl_usd"}}}'
```

Verified result today (values change; shape does not):

```
status: partial
coverage: {"requested_deployments":2,"successful_deployments":2,"nuthatch_available":false}
pool 0x6c561b44... tvl 151138739.377709
pool 0x72ab388e... tvl 6612457.78705088
```

`partial` is correct, not a failure. See Known gaps.

## Connect a client

```
claude mcp add --transport http deeptrace \
  https://wallet-intel.tail8ae57d.ts.net:8443/mcp \
  --header "Authorization: Bearer <TOKEN>"
claude mcp list
```

Verified: prints `deeptrace: ... (HTTP) - ✔ Connected`.

Remove with:

```
claude mcp remove deeptrace
```

## Verify the Nuthatch source

Three checks. All pass as of this writing.

### 1. /ready

```
curl -sS $NUTHATCH_BASE_URL/ready
```

Verified:

```
{"lag_blocks":45848,"ready":true,"sealed_through":49065709,"stalled":false,"tip":49111557}
```

`200` means ready. `503` maps to status `stale` in the adapter.

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

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Timeout on :8443 | Tailscale ACL identity mismatch. The shared user is `kapustazh@github` — a GitHub identity, not an email. An ACL grant naming an email never matches, and the denial presents as a timeout, indistinguishable from a dead port. Read the identity from Machines -> wallet-intel -> Sharing. |
| HTTP 401 | Wrong or missing bearer token. The network path is fine — 401 means the server was reached. |
| HTTP 404 on :8443/health | Only `/mcp` is routed. `/health` and `/ready` are Nuthatch routes on `:443`. |
| HTTP 400 `missing_session` | `tools/*` sent without the `mcp-session-id` header, or before the `initialized` notification. |
| Server exits at startup | `DEEPTRACE_HTTP_TOKEN` missing or shorter than 32 characters. |
| `records.json could not be read` | Built with bare `tsc`. Re-run `npm run build`. |
| All sources `unavailable` | `GRAPH_API_KEY` not set in the server's environment. |
| Connected but zero tools | A stale build is deployed. Rebuild and restart. |

ACL denials always look like timeouts. Before concluding a service is down, test
the same URL from a tailnet member. If a member succeeds and the shared user
times out, it is the ACL, every time.

## CT 104 operations

Service: `deeptrace-http.service`, `User=deploy`,
`WorkingDirectory=/opt/deeptrace`, `ExecStart=/usr/bin/node dist/http.js`,
`EnvironmentFile=/etc/deeptrace/http.env` (root:root, 0600, holds
`DEEPTRACE_HTTP_TOKEN`, `GRAPH_API_KEY`, `NUTHATCH_BASE_URL`).

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

Rotate the MCP token:

```
ssh root@pve 'pct exec 104 -- bash -c "openssl rand -hex 32 > /etc/deeptrace/token"'
```

Then update `DEEPTRACE_HTTP_TOKEN` in `/etc/deeptrace/http.env`, restart the
service, and reissue the token to every client.

## Known gaps

1. Nuthatch is not wired into `compare_pools`.
   `src/tools/live-sources.ts` returns `Promise.resolve(null)` from
   `fetchNuthatchResult`, so coverage always reports `nuthatch_available: false`.
   This is independent of nest health: all three Nuthatch checks above pass.
   Until that function calls the M5 adapter (`fetchNuthatchFreshness` in
   `src/sources/nuthatch/adapter.ts`), a `partial` result is the correct and
   expected output.
2. Nuthatch backfill has not reached the chain tip, so the freshness view trails
   live. Restart `nuthatch.service` to trigger RPC failover if it stalls.
3. There is no live integration test for the MCP server. The 382-test suite is
   entirely offline.
