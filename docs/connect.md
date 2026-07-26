# Connect an AI client

DeepTrace is available as a remote MCP server at:

```text
https://mcp.ikodo.dev
```

It uses the MCP Streamable HTTP transport and a bearer access token. Ask the
DeepTrace maintainer for a token through a secure channel.

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

Claude Code supports environment-variable expansion in HTTP headers. Export the
token in the shell that launches Claude Code:

```sh
read -rsp "DeepTrace token: " DEEPTRACE_TOKEN
export DEEPTRACE_TOKEN
```

Then add this project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "deeptrace": {
      "type": "http",
      "url": "https://mcp.ikodo.dev",
      "headers": {
        "Authorization": "Bearer ${DEEPTRACE_TOKEN}"
      }
    }
  }
}
```

The file contains only the variable reference, not the secret. Confirm the
connection:

```sh
claude mcp list
```

## Other AI clients

Use the four settings in the table when a client supports remote Streamable
HTTP MCP servers and custom headers. Client configuration formats differ, so
prefer the client's own secret storage over copying a token into plain JSON.

Some hosted chat connectors accept only OAuth or unauthenticated MCP servers
and cannot attach a fixed bearer header. The current DeepTrace endpoint does
not advertise OAuth. In those clients, do not paste the token into chat or add
it to the URL; use a client that supports a custom authorization header.

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

## Use the agent skill

Clients that support Agent Skills can install the
[`deeptrace-pool-research`](../skills/deeptrace-pool-research/SKILL.md) folder.
The skill makes the AI preserve exact decimal strings, separate Graph metrics
from Nuthatch facts, surface partial coverage, and avoid invented fallbacks.

## Troubleshoot

| Symptom | Meaning |
| --- | --- |
| `401 Unauthorized` | The server is reachable, but the bearer token is missing, invalid, or expired. |
| `404 Not Found` | Check that the hostname is exactly `mcp.ikodo.dev`; do not use `mcp.icodo.dev`. |
| Timeout or DNS failure | Check the exact hostname and the local network. Tailscale is not required. |
| Connected, but result is `partial` | Read `warnings` and `coverage`; one source may be unavailable or stale. |
| Client offers OAuth only | That client cannot use the current fixed-bearer endpoint directly. |
