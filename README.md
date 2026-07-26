![DeepTrace](logo.png)

**Verifiable Base DeFi data for builders and AI agents. Every number sourced, every gap declared.**

---

DeepTrace is a read-only [MCP](https://modelcontextprotocol.io) server. You connect it to
Claude Code, Codex, OpenCode, or any MCP client, and your assistant gains four research
tools for Base (chain `8453`).

The point is not "more data." The point is data an agent cannot fudge. Every answer says
where each number came from, how fresh it is, and what it could not see. When a source is
down, you get a partial result that says so — never a confident guess.

## What it answers

| Question | Tool |
| --- | --- |
| "Which WETH/USDC fee tier on Base has more volume this week?" | `compare_pools` |
| "Where is USDC lending paying best right now — Aave, Seamless, or Moonwell?" | `compare_lending_markets` |
| "Show me every swap over 50 WETH in that pool." | `find_large_swaps` |
| "What has this wallet been doing, and does it have an Aave position?" | `research_wallet` |

**`compare_pools`** ranks the two locked Uniswap V3 WETH/USDC fee tiers (0.30% and 0.05%)
by TVL, volume, or fees from Messari standardized subgraphs, and attaches an independent
freshness fact from our own Nuthatch index so you can tell whether the subgraph is lagging.

**`compare_lending_markets`** compares the native-USDC market across Aave v3, Seamless, and
Moonwell through one shared query template, so the three protocols are actually comparable
rather than three different definitions of "APY."

**`find_large_swaps`** pages through swaps in the locked pool above a threshold you set in
real WETH or USDC — not dollars. There is no price join, so there is nothing to get wrong.
Pagination uses an opaque cursor over a frozen snapshot, so page 2 still belongs to the
same moment as page 1.

**`research_wallet`** reports what our sources can actually observe about a public address:
its swaps in the indexed pool, who was on the other side of them, which assets and
protocols showed up, and its open Aave v3 positions. Ask for the sections you want over a
24h or 7d window.

## Connect

The hosted server is:

```text
https://mcp.ikodo.dev
```

You do not need a Graph API key, Nuthatch access, Tailscale, or a local checkout. Whatever
client you use, these are the only four settings:

| Setting | Value |
| --- | --- |
| Name | `deeptrace` |
| Transport | Streamable HTTP |
| URL | `https://mcp.ikodo.dev` |
| Header | `Authorization: Bearer <TOKEN>` |

There are two ways to authenticate. Clients that speak OAuth can skip tokens entirely: the
server implements OAuth 2.1 with PKCE and dynamic client registration, so the client
registers itself, you approve in the browser, and it stores its own credential. Everything
else uses a bearer token — open `https://mcp.ikodo.dev` in a browser and the page walks you
through getting one. Both flows, and their current client-compatibility limits, are covered
in [Authentication](docs/auth.md).

### Get the token into your shell

Read it without leaving a copy in shell history, then launch your client from that shell so
it inherits the variable:

```sh
read -rsp "DeepTrace token: " DEEPTRACE_TOKEN
export DEEPTRACE_TOKEN
```

Never put the token in a URL, a chat message, a support log, or a committed file. The
configs below reference the variable, so the files themselves stay safe to commit.

### Claude Code

Project-level `.mcp.json` in your repository root:

```json
{
  "mcpServers": {
    "deeptrace": {
      "type": "http",
      "url": "https://mcp.ikodo.dev",
      "headers": { "Authorization": "Bearer ${DEEPTRACE_TOKEN}" },
      "alwaysLoad": true
    }
  }
}
```

`alwaysLoad` keeps the tools immediately available instead of lazily discovered.

### OpenCode

User-level `~/.config/opencode/opencode.json`, or `opencode.json` in a project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "deeptrace": {
      "type": "remote",
      "url": "https://mcp.ikodo.dev",
      "enabled": true,
      "oauth": false,
      "headers": { "Authorization": "Bearer {env:DEEPTRACE_TOKEN}" }
    }
  }
}
```

Set `oauth` to `false` when you are using a bearer token, so OpenCode does not start OAuth
discovery instead of sending the header.

### Codex

User-level `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project. The Codex
CLI, IDE extension, and ChatGPT desktop experience all share this file:

```toml
[mcp_servers.deeptrace]
url = "https://mcp.ikodo.dev"
bearer_token_env_var = "DEEPTRACE_TOKEN"
```

### Any other client

Clients that only launch a local command, or that cannot attach a custom header, reach
DeepTrace through the `mcp-remote` bridge. This works anywhere `mcpServers` is understood:

```json
{
  "mcpServers": {
    "deeptrace": {
      "command": "npx",
      "args": ["mcp-remote", "--header", "Authorization:${AUTH_HEADER}", "https://mcp.ikodo.dev"],
      "env": {
        "AUTH_HEADER": "Bearer <TOKEN>"
      }
    }
  }
}
```

The missing space after `Authorization:` is deliberate — `mcp-remote` splits each `--header`
argument on the first colon, and a value containing a space can be mangled by the spawning
shell, so the scheme and token travel together in `AUTH_HEADER`. Prefer a native config from
above when your client has one; it is one less process and one less dependency.

### Verify it connected

```sh
claude mcp list
opencode mcp list
codex mcp list
```

Then ask your assistant something concrete, such as comparing Base WETH/USDC pools over the
last 24 hours by volume and reporting which sources answered. A `401` means the token is
missing, invalid, or expired; a `404` usually means a typo in the hostname. Fuller
per-client notes and a troubleshooting table are in
[Connect an AI client](docs/connect.md).

### Optional skill

The MCP connection is all you need — the server ships its own usage instructions, typed
inputs, and a declared output schema. For a richer workflow, the optional
[pool research skill](skills/deeptrace-pool-research/SKILL.md) teaches your client to
preserve exact decimals, keep Graph and Nuthatch facts separate, follow cursors correctly,
and surface partial coverage:

```sh
npx skills add https://github.com/ikodo0/deeptrace/tree/develop/skills/deeptrace-pool-research
```

The CLI detects your installed agents and asks which to target. Review the source before
approving; it does not configure MCP or handle your token. Start a new session afterward.

## Why you can trust the output

- **No model in the loop.** DeepTrace never calls an AI provider. It returns a verified
  structured envelope and nothing else — there is no generated prose, no reasoning field,
  and nothing for a model to hallucinate into the data. Interpretation is your client's job.
- **Read-only.** Every tool is annotated read-only and idempotent. Nothing signs, sends, or
  mutates anything.
- **Sourced.** Responses carry per-source provenance, coverage, and freshness. Subgraph
  deployments are pinned by hash and re-asserted on every call.
- **Honest about gaps.** One source failing produces a `partial` result with a warning, not
  a silent hole.
- **No invented numbers.** Financial values pass through as exact decimal strings. Windows
  are completed UTC days, so `24h` is the last full UTC day, not a rolling window. If those
  days are missing, the value is `null` rather than a shorter window quietly substituted.

## What it does not do

DeepTrace is deliberately narrow, and it will tell you so rather than improvise:

- Base only. No other chains.
- Pools: the WETH/USDC Uniswap V3 0.30% and 0.05% tiers, not every pool.
- Lending: the native-USDC market on three protocols, not every market.
- Swaps: the one indexed pool, thresholded in WETH or USDC. No USD conversion.
- Wallets: observed activity and Aave v3 positions — **not** complete balances, full
  transaction history, portfolio value, P&L, or ownership.

Pinned deployments and the exact field behind each metric are in
[source scope](docs/source-scope.md) and [wallet source scope](docs/wallet-source-scope.md).

## Run it yourself

Requires Node.js 22 or newer.

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Then start the stdio transport:

```sh
npm run build
npm start
```

Diagnostics go to stderr so they cannot corrupt the protocol stream on stdout. Point a
client at the built entry:

```json
{
  "mcpServers": {
    "deeptrace": {
      "command": "node",
      "args": ["/absolute/path/to/deeptrace/dist/index.js"]
    }
  }
}
```

## Documentation

| Document | What is in it |
| --- | --- |
| [Authentication](docs/auth.md) | How a client gets a credential, and the two ways in |
| [Connect an AI client](docs/connect.md) | Per-client setup and troubleshooting |
| [Source scope](docs/source-scope.md) | Pinned deployments and field mappings |
| [Wallet source scope](docs/wallet-source-scope.md) | What wallet research can and cannot see |
| [Contract](docs/CONTRACT.md) | The response contract |
| [MCP testing](docs/mcp-testing.md) | Handshake, smoke checks, operator procedure |
| [Deployment](docs/deployment.md) | Nuthatch deployment notes |
| [PLAN.md](PLAN.md) | Product direction and architecture |
