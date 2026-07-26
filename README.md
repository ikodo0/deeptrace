# DeepTrace

DeepTrace is a read-only Graph research MCP for builders and AI agents.

The supported product transport is stateful Streamable HTTP at `/mcp`, protected
by a bearer token. The public deployment is:

```text
https://mcp.ikodo.dev/mcp
```

Two read-only tools are registered, both reading Messari standardized subgraphs
on Base so one schema family covers a DEX AMM and three lending protocols:

- `compare_pools` compares the locked WETH/USDC 0.3% and 0.05% Uniswap V3 fee
  tiers, and augments the result with internal Nuthatch swap freshness.
- `compare_lending_markets` compares the native-USDC market across Aave v3,
  Seamless, and Moonwell through one shared query template.

Clients connect only to DeepTrace; Nuthatch is not a public MCP endpoint. Every
response carries coverage, freshness, and per-source provenance, and reports a
partial result rather than failing when one source is unavailable. Pinned
deployments and the field mappings behind each metric are documented in
[`docs/source-scope.md`](docs/source-scope.md).

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

## Start the Server

Copy the environment template, set at least `DEEPTRACE_HTTP_TOKEN` and
`GRAPH_API_KEY`, then build and start:

```sh
cp .env.example .env
npm run build
set -a
source .env
set +a
npm start
```

The listener defaults to `127.0.0.1:8787` and serves only `/mcp`. Keep the
loopback default when a reverse proxy terminates public TLS. The application
does not load `.env` itself; the shell or service manager must export it.

## MCP Client Configuration

Configure a remote HTTP server and inject the bearer token from local credential
storage. For Claude Code:

```sh
claude mcp add --transport http deeptrace \
  https://mcp.ikodo.dev/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

Never commit or place the bearer token in the URL. See
[`docs/mcp-testing.md`](docs/mcp-testing.md) for local testing, the complete
handshake, remote smoke checks, deployment operations, and current source
limitations. Nuthatch deployment notes live in
[`docs/deployment.md`](docs/deployment.md).
