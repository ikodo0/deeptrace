# DeepTrace

DeepTrace is a read-only Graph research MCP for builders and AI agents.

The current foundation starts an MCP server over stdio. Public research tools
are added in later milestones; this branch does not register a provisional
`compare_pools` tool.

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

Build before starting:

```sh
npm run build
npm start
```

The server reads MCP messages from stdin and writes MCP messages to stdout.
Application diagnostics use stderr so they cannot corrupt the protocol stream.

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

Current Nuthatch deployment notes live in `docs/deployment.md`. Live source
adapter configuration and `compare_pools` are integrated in later milestones.
