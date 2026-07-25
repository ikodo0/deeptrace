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
| Nuthatch source API | https://<TAILNET_HOST> (:443) | 127.0.0.1:8288 | the DeepTrace Nuthatch adapter |
| DeepTrace MCP gateway | https://<TAILNET_HOST>:8443/mcp | 127.0.0.1:8787 | MCP clients (Claude Code etc.) |

Both are tailnet-only via Tailscale Serve. There is no Funnel.

The MCP gateway serves only the path `/mcp`. Everything else returns 404.
`/health`, `/ready`, `/nest`, `/schema`, `/sql` are Nuthatch routes on `:443`;
they do not exist on `:8443`.

## For an external collaborator

This is the whole path for someone outside the tailnet who only needs to call
the tool. You do not clone the repo, build anything, or hold any Graph
credential.

### What you need from the maintainer

1. A Tailscale node-share invitation for the machine `wallet-intel`. Accept it
   from the invite link. It shares one machine only — the rest of the tailnet
   stays invisible.
2. The bearer token for the MCP gateway. Sent out of band, never in the repo.
3. The gateway URL: https://<TAILNET_HOST>:8443/mcp
4. Confirmation that the maintainer has applied the ACL grant for your
   Tailscale identity on tcp:8443. Without it every request times out.

### Setup

Join the tailnet:

```
tailscale up
tailscale status        # expect a wallet-intel row
```

Register the MCP server with Claude Code:

```
claude mcp add --transport http deeptrace \
  https://<TAILNET_HOST>:8443/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

Confirm it connected:

```
claude mcp list         # expect: deeptrace: ... (HTTP) - ✔ Connected
```

### First call

Ask the agent to compare Base WETH/USDC pools, or call the `compare_pools`
tool with `chain_id` `8453`, `token0`
`0x4200000000000000000000000000000000000006` and `token1`
`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`. A result with status `partial`
is a success: two Graph sources answered, Nuthatch is not wired in yet. See
"Known gaps" for why.

### If it does not work — report back which one

| You see | What it means |
| --- | --- |
| Timeout | The ACL grant is missing or names the wrong identity. A maintainer fix, not yours. Send them your exact Tailscale identity. |
| HTTP 401 | You reached the server; the token is wrong or stale. Ask for a reissue. |
| HTTP 404 | Check the URL ends in `/mcp`. Only that path is served on `:8443`. |

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
| `NUTHATCH_BASE_URL` | `https://<TAILNET_HOST>`, no trailing slash. |

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
DEEPTRACE_MCP_URL=https://<TAILNET_HOST>:8443/mcp \
DEEPTRACE_HTTP_TOKEN=<TOKEN> \
  npm run smoke:mcp
```

```
auth gate (no token)         PASS  status=401 (expected 401)
unknown path                 PASS  status=404 (expected 404)
initialize                   PASS  status=200 sid=60464046
notifications/initialized    PASS  status=202 (expected 202)
tools/list                   PASS  tools=[compare_pools]
tools/call                   PASS  status=partial 2/2
6 passed, 0 failed
```

Both variables are required; missing ones are reported by name only. The exit
code is 0 only when every check passes, so it works unchanged in CI or a
post-deploy hook. Point `DEEPTRACE_MCP_URL` at `http://127.0.0.1:8787/mcp` to
check a local instance instead.

`status=partial` on the final check is a pass: the Graph sources answered and
Nuthatch is not yet wired in. See "Known gaps".

### Manual path

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
  https://<TAILNET_HOST>:8443/mcp \
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

1. Nuthatch backfill has not reached the chain tip, so the freshness view trails
   live. Restart `nuthatch.service` to trigger RPC failover if it stalls.
   `compare_pools` invokes the live freshness adapter and reports that source as
   stale until the backfill catches up, so a `partial` result remains expected.
2. There is no live integration test for the MCP server. The offline test suite is
   entirely offline.
