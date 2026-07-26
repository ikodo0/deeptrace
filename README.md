# DeepTrace

DeepTrace is a read-only research MCP that compares Base liquidity pools with
Graph subgraph metrics and independent Nuthatch swap freshness.

## Connect

Use the public Streamable HTTP endpoint:

```text
https://mcp.ikodo.dev
```

Configure the access token as an `Authorization: Bearer` header in your MCP
client. A normal user does not need Tailscale, a Graph API key, Nuthatch access,
or a local checkout. See [Connect an AI client](docs/connect.md) for the short
setup and compatibility notes.

The installable
[DeepTrace Pool Research skill](skills/deeptrace-pool-research/SKILL.md)
teaches a client AI how to call `compare_pools`, explain the separate Graph and
Nuthatch evidence, and preserve warnings and provenance.

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
