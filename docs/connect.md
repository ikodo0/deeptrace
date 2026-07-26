# Connect an AI client

DeepTrace is available as a remote MCP server at:

```text
https://mcp.ikodo.dev
```

It uses the MCP Streamable HTTP transport and a bearer access token, the same
shape as other hosted research MCPs: you hold your own key and send it as an
`Authorization` header.

## Get a key

Tokens are self-serve: open <https://mcp.ikodo.dev/auth> in a browser and press the
button, or add the server with no header at all and let an OAuth-capable client
discover the flow and store its own credential.

[Authentication](auth.md) covers both paths in full, along with token handling,
the OAuth endpoints, and current client-compatibility limits.

## What a user needs

Configure one remote MCP server with these values:

| Setting | Value |
| --- | --- |
| Name | `deeptrace` |
| Transport | Streamable HTTP |
| URL | `https://mcp.ikodo.dev` |
| Header | `Authorization: Bearer <TOKEN>` |

Store the token using the client's secret or environment-variable support.
Never put it in the URL, a chat prompt, a committed configuration file, or a
support log.

That is the entire public connection. The user's device does not connect to
Nuthatch directly and does not need Tailscale, repository access, a Graph API
key, an RPC URL, or a local server.

The older `https://mcp.ikodo.dev/mcp` URL remains a compatibility alias, but new
connections should use the root URL.

## Claude Code

Claude Code supports environment-variable expansion in HTTP headers. Add this
project-level `.mcp.json`:

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

`alwaysLoad` keeps DeepTrace's single read-only tool immediately available. The
file contains only the variable reference, not the secret.

## OpenCode

Add this to the user-level `~/.config/opencode/opencode.json` or to a project's
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "deeptrace": {
      "type": "remote",
      "url": "https://mcp.ikodo.dev",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:DEEPTRACE_TOKEN}"
      }
    }
  }
}
```

Setting `oauth` to `false` tells OpenCode that this server uses the configured
bearer token instead of starting OAuth discovery.

## Codex

Add this to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted
project:

```toml
[mcp_servers.deeptrace]
url = "https://mcp.ikodo.dev"
bearer_token_env_var = "DEEPTRACE_TOKEN"
```

The Codex CLI, IDE extension, and ChatGPT desktop Codex experience share this
MCP configuration.

## Set the token and verify

In Bash or Zsh, read the token without writing it to shell history:

```sh
read -rsp "DeepTrace token: " DEEPTRACE_TOKEN
export DEEPTRACE_TOKEN
```

Launch the AI client from that shell. Then verify the connection:

```sh
claude mcp list
opencode mcp list
codex mcp list
```

Claude Code and Codex use DeepTrace's MCP server instructions to understand
when and how to use the tool. OpenCode receives the same safety guidance in the
tool description and all three clients receive a declared output schema plus
structured results.

## Any client, through mcp-remote

Clients that only launch a local command — or that cannot attach a custom
header — reach DeepTrace through the `mcp-remote` bridge. This is the widely
used shape for hosted MCP servers and works anywhere `mcpServers` is understood:

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

Note the missing space after `Authorization:`. `mcp-remote` splits each
`--header` argument on the first colon, and a value containing a space can be
mangled by the shell that spawns it, so the scheme and the token both live in
`AUTH_HEADER` instead. Keep the real token in your environment or secret store
and leave the `${AUTH_HEADER}` reference in the file.

Prefer a native configuration from the sections above when your client has one:
it is one less process and one less dependency. Use `mcp-remote` only when the
client cannot send a header itself.

## Other clients

Use the four settings in the table when a client supports remote Streamable
HTTP MCP servers and custom headers. Client configuration formats differ, so
prefer the client's own secret storage over copying a token into plain JSON.

Some hosted chat connectors accept only OAuth or unauthenticated MCP servers
and cannot attach a fixed bearer header. DeepTrace advertises OAuth 2.1
authorization code with PKCE, so those clients can connect with no header at
all — add the URL alone and approve the consent page. In any client, do not
paste a token into chat or add it to the URL.

For general remote-server connection guidance, see the
[official MCP guide](https://modelcontextprotocol.io/docs/develop/connect-remote-servers).

## Try it

After the client reports that `deeptrace` is connected, ask:

> Compare Base WETH/USDC pools over the last 24 hours by volume. Tell me which
> sources answered, whether Nuthatch is fresh, and show any warnings.

The available `compare_pools` tool currently supports:

- Base chain ID `8453`
- WETH `0x4200000000000000000000000000000000000006`
- native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- `24h` or `7d`
- ranking by TVL, volume, or fees
- one to three ranked pools

Graph subgraphs provide pool TVL, volume, and fee metrics. Nuthatch separately
reports whether recent Uniswap V3 swap indexing is fresh for its registered
pool. Nuthatch does not provide the USD metrics and does not prove subgraph
parity.

A `partial` result can still contain useful evidence. Read its coverage,
freshness, warnings, and provenance before relying on the ranking.

For large swaps, ask:

> Find swaps of at least 5 WETH in the supported Base pool. Show exact token
> amounts, transaction and block identities, source freshness, and whether
> another page is available.

`find_large_swaps` supports only the registered Uniswap V3 pool
`0x6c561b446416e1a00e8e93e221854d6ea4171372`, with an exact positive WETH or
native-USDC human-unit threshold and page size from 1 to 100. It does not
calculate USD notional. Continue with the returned opaque cursor without
changing the request scope.

## Optional agent skill

The MCP connection is the only required setup. Claude Code, OpenCode, and Codex
receive the tool schema, structured results, and essential safety instructions
from the server.

For a richer workflow, install the optional
[`deeptrace-pool-research`](../skills/deeptrace-pool-research/SKILL.md) skill
from the project where you use your AI:

```sh
npx skills add https://github.com/ikodo0/deeptrace/tree/develop/skills/deeptrace-pool-research
```

The open-source `skills` CLI detects supported agents and asks which ones to
target. Keep the confirmation prompt so you can review the source before
installing it. The default project-scoped install is portable across Claude
Code, OpenCode, and Codex and is easier to audit with the rest of the project.
Start a new AI session after installation.

On Windows, run the same command with `npx.cmd`. If Node.js is unavailable,
download or clone the complete skill folder—not only `SKILL.md`—and place it at
one of these project paths:

- Claude Code: `.claude/skills/deeptrace-pool-research/`
- OpenCode or Codex: `.agents/skills/deeptrace-pool-research/`

The skill preserves exact decimal strings, separates Graph metrics from
Nuthatch facts, follows stable large-swap cursors, surfaces partial or failed
coverage, and avoids invented fallbacks. It does not configure the MCP
connection, receive the bearer token, or replace the required URL-and-token
setup.

## Troubleshoot

| Symptom | Meaning |
| --- | --- |
| `401 Unauthorized` | The server is reachable, but the bearer token is missing, invalid, or revoked. Take a fresh one at `/auth`, or remove the header and let the client run OAuth. |
| `404 Not Found` | Check that the hostname is exactly `mcp.ikodo.dev`; do not use `mcp.icodo.dev`. |
| Timeout or DNS failure | Check the exact hostname and the local network. Tailscale is not required. |
| Connected, but result is `partial` | Read `warnings` and `coverage`; one source may be unavailable or stale. |
| Client offers OAuth only | Supported. Add the URL with no header and approve the consent page. |
| `Needs authentication` from `claude mcp list` | Expected before the first OAuth approval. Run `/mcp` in Claude Code to finish it. |
| `invalid_redirect_uri` during OAuth | The client asked to be called back at an address the server will not send a code to. Report the client and its callback shape. |
