// One-command MCP smoke test. Run with:
//   DEEPTRACE_MCP_URL=... DEEPTRACE_HTTP_TOKEN=... npm run smoke:mcp
//
// Uses only built-in fetch and node:process. No new dependencies.
// Never prints the token, any Authorization header, or a session id.

import process from "node:process";

const SHORT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 90_000;

const MCP_URL = process.env.DEEPTRACE_MCP_URL ?? "";
const TOKEN = process.env.DEEPTRACE_HTTP_TOKEN ?? "";

const missing = [];
if (MCP_URL === "") missing.push("DEEPTRACE_MCP_URL");
if (TOKEN === "") missing.push("DEEPTRACE_HTTP_TOKEN");
if (missing.length > 0) {
  console.error(`missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const origin = (() => {
  try {
    const u = new URL(MCP_URL);
    return `${u.protocol}//${u.host}`;
  } catch {
    console.error(`DEEPTRACE_MCP_URL is not a valid URL`);
    process.exit(1);
  }
})();

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const authHeaders = () => ({
  ...JSON_HEADERS,
  Authorization: `Bearer ${TOKEN}`,
});

let pass = 0;
let fail = 0;

function report(label, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  const padded = label.padEnd(28);
  console.log(`${padded} ${status}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

async function runCheck(label, fn) {
  let ok = false;
  let detail;
  try {
    ({ ok, detail } = await fn());
  } catch (err) {
    detail = `error: ${err.message}`;
  }
  report(label, ok, detail);
  return ok;
}

function parseSse(text) {
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith("data: ")) {
      const payload = trimmed.slice("data: ".length);
      if (payload === "" || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload);
      } catch {
        // skip non-JSON data lines
      }
    }
  }
  return null;
}

function parseJsonRpc(text) {
  const sseMessage = parseSse(text);
  if (sseMessage !== null) return sseMessage;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJson(url, body, { headers, timeoutMs }) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

const initializeParams = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "1" },
};

// Check 1: auth gate (no Authorization header) -> expect 401
await runCheck("auth gate (no token)", async () => {
  const { status } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams },
    { headers: JSON_HEADERS, timeoutMs: SHORT_TIMEOUT_MS },
  );
  return { ok: status === 401, detail: `status=${status} (expected 401)` };
});

// Check 2: unknown path GET <origin>/health -> expect 404
await runCheck("unknown path", async () => {
  const res = await fetch(`${origin}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(SHORT_TIMEOUT_MS),
  });
  return { ok: res.status === 404, detail: `status=${res.status} (expected 404)` };
});

// Check 3: initialize -> expect 200 and non-empty mcp-session-id
let sessionId = "";
let negotiatedProtocolVersion = "";
const initOk = await runCheck("initialize", async () => {
  const { status, headers, text } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", id: 2, method: "initialize", params: initializeParams },
    { headers: authHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
  );
  const sid = headers.get("mcp-session-id") ?? "";
  if (status !== 200) {
    return { ok: false, detail: `status=${status} (expected 200)` };
  }
  if (sid === "") {
    return { ok: false, detail: `status=200 sid=(empty)` };
  }

  sessionId = sid;
  const message = parseJsonRpc(text);
  const protocolVersion = message?.result?.protocolVersion;
  if (protocolVersion !== initializeParams.protocolVersion) {
    return { ok: false, detail: `status=200 invalid protocolVersion` };
  }
  negotiatedProtocolVersion = protocolVersion;
  return { ok: true, detail: `status=200 session=established` };
});

const sessionHeaders = () => ({
  ...authHeaders(),
  "mcp-session-id": sessionId,
  "MCP-Protocol-Version": negotiatedProtocolVersion || initializeParams.protocolVersion,
});

async function closeSession() {
  try {
    const response = await fetch(MCP_URL, {
      method: "DELETE",
      headers: sessionHeaders(),
      signal: AbortSignal.timeout(SHORT_TIMEOUT_MS),
    });
    await response.text();
  } catch {
    // Session termination is best effort and must not hide the smoke result.
  }
}

if (!initOk || sessionId === "") {
  if (sessionId !== "") await closeSession();
  console.log("initialize failed; skipping remaining checks");
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(1);
}

const EXPECTED_TOOLS = ["compare_pools", "compare_lending_markets", "find_large_swaps"];

// Checks 6+: tools/call each public tool with its locked allowlisted args.
// Pool/lending calls pass on complete or partial. Large-swap calls require a
// complete 1/1 coverage settlement (develop's stricter LSS smoke gate).
async function callTool({ id, name, args, requestedKey, successKey, requireComplete = false }) {
  const { status, text } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
    { headers: sessionHeaders(), timeoutMs: CALL_TIMEOUT_MS },
  );
  if (status !== 200) {
    return { ok: false, detail: `status=${status} (expected 200)` };
  }
  const msg = parseJsonRpc(text);
  const rawText = msg?.result?.content?.[0]?.text;
  if (typeof rawText !== "string") {
    return { ok: false, detail: `status=200 no content[0].text` };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, detail: `result not JSON: ${err.message}` };
  }
  const st = parsed?.status;
  const coverage = parsed?.coverage ?? {};
  const success = coverage[successKey];
  const requested = coverage[requestedKey];
  const covStr =
    typeof success === "number" && typeof requested === "number"
      ? `${success}/${requested}`
      : "?/?";
  const ok = requireComplete
    ? st === "complete" && covStr === "1/1"
    : st === "complete" || st === "partial";
  return { ok, detail: `status=${st} ${covStr}` };
}

try {
  // Check 4: notifications/initialized -> expect 202
  await runCheck("notifications/initialized", async () => {
    const { status } = await postJson(
      MCP_URL,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { headers: sessionHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
    );
    return { ok: status === 202, detail: `status=${status} (expected 202)` };
  });

  // Check 5: tools/list -> SSE payload advertises all three public tools
  await runCheck("tools/list", async () => {
    const { status, text } = await postJson(
      MCP_URL,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { headers: sessionHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
    );
    const msg = parseJsonRpc(text);
    const tools = msg?.result?.tools ?? [];
    const names = tools.map((t) => t?.name).filter((n) => typeof n === "string");
    const missingTools = EXPECTED_TOOLS.filter((n) => !names.includes(n));
    const ok = status === 200 && missingTools.length === 0;
    let detail = `tools=[${names.join(",")}]`;
    if (status !== 200) detail = `status=${status} (expected 200)`;
    else if (missingTools.length > 0) detail += ` missing=[${missingTools.join(",")}]`;
    return { ok, detail };
  });

  await runCheck("tools/call compare_pools", () =>
    callTool({
      id: 4,
      name: "compare_pools",
      args: {
        chain_id: 8453,
        token0: "0x4200000000000000000000000000000000000006",
        token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        window: "24h",
        ranked_by: "tvl_usd",
      },
      requestedKey: "requested_deployments",
      successKey: "successful_deployments",
    }),
  );

  await runCheck("tools/call compare_lending_markets", () =>
    callTool({
      id: 5,
      name: "compare_lending_markets",
      args: {
        chain_id: 8453,
        market_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        ranked_by: "tvl_usd",
      },
      requestedKey: "requested_sources",
      successKey: "successful_sources",
    }),
  );

  await runCheck("tools/call find_large_swaps", () =>
    callTool({
      id: 6,
      name: "find_large_swaps",
      args: {
        chain_id: 8453,
        pool_address: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
        threshold_token: "0x4200000000000000000000000000000000000006",
        min_amount: "1",
        limit: 1,
      },
      requestedKey: "requested_sources",
      successKey: "successful_sources",
      requireComplete: true,
    }),
  );
} finally {
  await closeSession();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
