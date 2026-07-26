# DeepTrace

DeepTrace is a read-only research MCP that compares Base liquidity pools with
Graph subgraph metrics and independent Nuthatch swap freshness, and returns
stable pages of token-thresholded swaps from the locked Base Uniswap V3
WETH/USDC pool.

## Connect

Use the public Streamable HTTP endpoint:

```text
https://mcp.ikodo.dev
```

Configure the access token as an `Authorization: Bearer` header in your MCP
client. A normal user does not need Tailscale, a Graph API key, Nuthatch access,
or a local checkout. See [Connect an AI client](docs/connect.md) for the short
setup and compatibility notes.

The optional installable
[DeepTrace Pool Research skill](skills/deeptrace-pool-research/SKILL.md)
adds a richer workflow. The MCP server itself supplies essential usage
instructions, described inputs, a declared output schema, and structured
results so Claude Code, OpenCode, and Codex work without a separate skill
installation.

Released tools:

- `compare_pools` — rank the locked Base WETH/USDC pools by Graph-reported TVL,
  volume, or fees, with independent Nuthatch freshness.
- `find_large_swaps` — search the locked Uniswap V3 pool using an exact WETH or
  USDC human-unit threshold and opaque fixed-snapshot pagination. V1 performs
  no USD conversion.

Install the optional skill from your project with:

```sh
npx skills add https://github.com/ikodo0/deeptrace/tree/develop/skills/deeptrace-pool-research
```

The command prompts for the detected AI client. Review the skill before
approving installation; it does not configure MCP or store the bearer token.

## Requirements

- Node.js 22 or newer
- npm

## Install and Verify

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Run locally

Build before starting:

```sh
npm run build
npm start
```

`npm start` runs the stdio transport. Application diagnostics use stderr so
they cannot corrupt the protocol stream.

## MCP Client Configuration

Use an absolute path to the built entry point:

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

Deployment notes live in [docs/deployment.md](docs/deployment.md), and the
operator test procedure lives in [docs/mcp-testing.md](docs/mcp-testing.md).
