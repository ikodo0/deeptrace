import { HTTP_ENV_VARS, loadHttpConfig } from "./http/config.js";
import { createHttpServer, listen } from "./http/server.js";
import { installShutdownHandlers } from "./mcp/lifecycle.js";

async function main(): Promise<void> {
  const config = loadHttpConfig();
  const runtime = createHttpServer(config);
  await listen(runtime, config);
  console.error(
    `[deeptrace] MCP HTTP transport listening on ${config.host}:${String(config.port)}`,
  );
  if (config.sharedToken !== undefined) {
    console.error(
      `[deeptrace] ${HTTP_ENV_VARS.sharedToken} is still accepted. One leak of it exposes every client and cannot be revoked alone. Retire it by removing the variable; clients mint their own token at /auth.`,
    );
  }
  installShutdownHandlers(runtime);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`[deeptrace] Failed to start MCP HTTP transport: ${message}`);
  process.exitCode = 1;
});
