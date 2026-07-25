// One-command MCP smoke test. Run with:
//   DEEPTRACE_MCP_URL=... DEEPTRACE_HTTP_TOKEN=... npm run smoke:mcp
//
// Uses only built-in fetch and node:process. No new dependencies.
// Never prints the token, any Authorization header, or a full session id.

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
const initOk = await runCheck("initialize", async () => {
  const { status, headers } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", id: 2, method: "initialize", params: initializeParams },
    { headers: authHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
  );
  const sid = headers.get("mcp-session-id") ?? "";
  if (status === 200 && sid !== "") {
    sessionId = sid;
    return { ok: true, detail: `status=200 sid=${sid.slice(0, 8)}` };
  }
  if (status !== 200) {
    return { ok: false, detail: `status=${status} (expected 200)` };
  }
  return { ok: false, detail: `status=200 sid=(empty)` };
});

if (!initOk || sessionId === "") {
  console.log("initialize failed; skipping remaining checks");
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(1);
}

const sessionHeaders = () => ({
  ...authHeaders(),
  "mcp-session-id": sessionId,
});

// Check 4: notifications/initialized -> expect 202
await runCheck("notifications/initialized", async () => {
  const { status } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { headers: sessionHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
  );
  return { ok: status === 202, detail: `status=${status} (expected 202)` };
});

// Check 5: tools/list -> SSE payload contains compare_pools
await runCheck("tools/list", async () => {
  const { status, text } = await postJson(
    MCP_URL,
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { headers: sessionHeaders(), timeoutMs: SHORT_TIMEOUT_MS },
  );
  const msg = parseSse(text);
  const tools = msg?.result?.tools ?? [];
  const names = tools.map((t) => t?.name).filter((n) => typeof n === "string");
  const ok = status === 200 && names.includes("compare_pools");
  const detail = status !== 200 ? `status=${status} (expected 200)` : `tools=[${names.join(",")}]`;
  return { ok, detail };
});

// Check 6: tools/call compare_pools with locked args
await runCheck("tools/call", async () => {
  const { status, text } = await postJson(
    MCP_URL,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "compare_pools",
        arguments: {
          chain_id: 8453,
          token0: "0x4200000000000000000000000000000000000006",
          token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          window: "24h",
          ranked_by: "tvl_usd",
        },
      },
    },
    { headers: sessionHeaders(), timeoutMs: CALL_TIMEOUT_MS },
  );
  if (status !== 200) {
    return { ok: false, detail: `status=${status} (expected 200)` };
  }
  const msg = parseSse(text);
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
  const success = coverage.successful_deployments;
  const requested = coverage.requested_deployments;
  const covStr =
    typeof success === "number" && typeof requested === "number"
      ? `${success}/${requested}`
      : "?/?";
  const ok = st === "ok" || st === "partial";
  return { ok, detail: `status=${st} ${covStr}` };
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
