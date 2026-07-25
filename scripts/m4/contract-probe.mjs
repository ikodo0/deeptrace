#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const binary = option("--binary", "/home/arch/.local/bin/nuthatch");
const outDir = path.resolve(option("--out-dir", "tests/integration/__evidence__/m4"));
const source = path.resolve(option("--nest-source", "scripts/m4/local-fixture"));
const fixedBaseUrl = option("--base-url");
const table = option("--table", "probe__probe");
const repeat = Number(option("--repeat", "2"));
const host = option("--host", "127.0.0.1");
const endpoint = option("--endpoint", "/");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  if (!process.argv[at + 1]) throw new Error(`missing value for ${name}`);
  return process.argv[at + 1];
}

function redact(text) {
  return text
    .replaceAll(/([?&](?:key|api_?key|token|secret|password)=)[^&\s]+/gi, "$1<redacted>")
    .replaceAll(/https?:\/\/[^/\s]+\/(?:v\d\/)?[A-Za-z0-9_-]{20,}/g, "<redacted-url>")
    .replaceAll(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .replaceAll(/\/tmp\/nuthatch-contract-probe-[A-Za-z0-9_-]+/g, "<temporary-directory>");
}

async function command(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeout ?? 20_000);
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command: `nuthatch ${args.join(" ")}`,
        exit_code: exitCode,
        signal,
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no loopback port"));
      server.close(() => resolve(address.port));
    });
  });
}

function background(program, args) {
  const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function stop(handle) {
  if (!handle || handle.child.exitCode !== null) return;
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => handle.child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
}

async function waitFor(baseUrl, handle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
      throw new Error(`nuthatch dev exited\n${handle.stdout}\n${handle.stderr}`);
    }
    try {
      if ((await fetch(new URL("/health", baseUrl))).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("nuthatch dev health timeout");
}

async function request(method, baseUrl, route, query, parameter = "q") {
  const url = new URL(route, baseUrl);
  if (query) url.searchParams.set(parameter, query);
  const response = await fetch(url, { method });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return {
    method,
    path: route,
    status: response.status,
    content_type: response.headers.get("content-type"),
    allow: response.headers.get("allow"),
    response_fields:
      body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : null,
    body,
  };
}

function normalize(value) {
  return JSON.parse(
    redact(JSON.stringify(value))
      .replaceAll(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "<timestamp>")
      .replaceAll(/"(tip|last_block|sealed_through)"\s*:\s*\d+/g, '"$1":"<volatile>"'),
  );
}

async function writeEvidence(name, value) {
  await writeFile(path.join(outDir, name), `${JSON.stringify(normalize(value), null, 2)}\n`);
}

async function cliEvidence() {
  const captures = {};
  for (const args of [
    ["--version"],
    ["init", "--help"],
    ["dev", "--help"],
    ["sql", "--help"],
    ["check", "--help"],
    ["nest", "--help"],
    ["mcp", "--help"],
  ])
    captures[args.join(" ")] = await command(args);
  return captures;
}

async function httpEvidence(baseUrl) {
  const endpoints = {};
  for (const route of ["/health", "/ready", "/nest", "/schema", "/tables", "/metrics"]) {
    const result = await request("GET", baseUrl, route);
    if (route === "/metrics") {
      result.body = String(result.body)
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(/[ {]/)[0])
        .filter((name, index, all) => all.indexOf(name) === index)
        .sort();
    }
    endpoints[route] = result;
  }
  const query = `SELECT * FROM "${table}" ORDER BY block_number LIMIT 2`;
  const parameters = {};
  for (const name of ["q", "query", "sql"]) {
    const result = await request("GET", baseUrl, "/sql", query, name);
    parameters[name] = { status: result.status, response_fields: result.response_fields };
  }
  return {
    target: baseUrl,
    endpoints,
    sql: {
      get: await request("GET", baseUrl, "/sql", query),
      post: await request("POST", baseUrl, "/sql", query),
      tested_query_parameters: parameters,
      real_query_parameter_names: Object.entries(parameters)
        .filter(([, result]) => result.status === 200)
        .map(([name]) => name),
    },
    explain: await request("GET", baseUrl, "/explain", `SELECT count(*) FROM "${table}"`),
  };
}

async function guardEvidence(baseUrl) {
  const row = await request("GET", baseUrl, "/sql", "SELECT i FROM range(20000) t(i)");
  const bytes = await request("GET", baseUrl, "/sql", "SELECT repeat('x', 12000000) payload");
  const timeout = await request(
    "GET",
    baseUrl,
    "/sql",
    "SELECT count(*) FROM range(1000000000) a, range(1000000000) b",
  );
  const concurrent = await Promise.all(
    Array.from({ length: 16 }, () =>
      request(
        "GET",
        baseUrl,
        "/sql",
        `SELECT count(*) FROM "${table}" a, "${table}" b, "${table}" c`,
      ),
    ),
  );
  return {
    timeout: { status: timeout.status, body: timeout.body },
    row: {
      status: row.status,
      rows_returned: Array.isArray(row.body?.rows) ? row.body.rows.length : null,
      truncated: row.body?.truncated ?? null,
      error: row.body?.error ?? null,
    },
    byte: {
      status: bytes.status,
      response_bytes: Buffer.byteLength(JSON.stringify(bytes.body)),
      error: bytes.body?.error ?? null,
    },
    concurrency: {
      requests: concurrent.length,
      active: concurrent.some((result) => result.status !== 200),
      statuses: [...new Set(concurrent.map((result) => result.status))].sort(),
      errors: [...new Set(concurrent.map((result) => result.body?.error).filter(Boolean))].sort(),
    },
  };
}

async function schemaEvidence(baseUrl, nestDir) {
  const generated = JSON.parse(await readFile(path.join(nestDir, "schema.json"), "utf8"));
  const describe = await request("GET", baseUrl, "/sql", `DESCRIBE SELECT * FROM "${table}"`);
  const decimalQuery = `SELECT amount_dec, signedAmount_dec FROM "${table}" LIMIT 1`;
  return {
    generated_schema: generated,
    live_describe: describe.body,
    decimal_siblings_and_overflow_flags: await request("GET", baseUrl, "/sql", decimalQuery),
  };
}

async function checkEvidence(nestDir) {
  await mkdir(path.join(nestDir, "checks", "expected"), { recursive: true });
  await writeFile(
    path.join(nestDir, "checks", "contract.sql"),
    `SELECT count(*) AS rows FROM "${table}";\n`,
  );
  const update = await command(["check", "--update", "--dir", nestDir]);
  let fixture = null;
  try {
    fixture = JSON.parse(
      await readFile(path.join(nestDir, "checks", "expected", "contract.json"), "utf8"),
    );
  } catch {
    /* fixture absent */
  }
  return {
    update,
    recorded_path: "checks/expected/contract.json",
    recorded_value: fixture,
    verification: await command(["check", "--dir", nestDir]),
  };
}

async function localCapture() {
  const workDir = await mkdtemp(path.join(tmpdir(), "nuthatch-contract-probe-"));
  const nestDir = path.join(workDir, "nest");
  const rpcPort = await freePort();
  const apiPort = await freePort();
  const rpc = background("node", [path.resolve("scripts/m4/fake-rpc.mjs"), String(rpcPort)]);
  let dev;
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const init = await command(["init", "--from", source, "--dir", nestDir]);
    if (init.exit_code !== 0) throw new Error(init.stderr);
    const configPath = path.join(nestDir, "nest.star");
    const config = (await readFile(configPath, "utf8")).replace(
      "http://127.0.0.1:1",
      `http://127.0.0.1:${rpcPort}`,
    );
    await writeFile(configPath, config);
    const schema = await command(["schema", "--dir", nestDir]);
    if (schema.exit_code !== 0) throw new Error(schema.stderr);
    const baseUrl = `http://${host}:${apiPort}${endpoint}`;
    dev = background(binary, [
      "dev",
      "--dir",
      nestDir,
      "--listen",
      `${host}:${apiPort}`,
      "--backfill",
      "20",
      "--seal-direct",
      "--concurrency",
      "2",
      "--no-admin",
    ]);
    await waitFor(baseUrl, dev);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const evidence = {
      http: await httpEvidence(baseUrl),
      guards: await guardEvidence(baseUrl),
      schema: await schemaEvidence(baseUrl, nestDir),
      devFlags: {
        authored_start_block: 1,
        backfill_argument: 20,
        seal_direct: true,
        concurrency: 2,
        rpc_get_logs_ranges: rpc.stdout
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line)),
      },
    };
    await stop(dev);
    dev = null;
    evidence.check = await checkEvidence(nestDir);
    await writeFile(configPath, config.replace(`http://127.0.0.1:${rpcPort}`, "${PROBE_RPC_URL}"));
    const env = await command(["dev", "--dir", nestDir, "--listen", `${host}:${apiPort}`], {
      timeout: 2_000,
      env: { ...process.env, PROBE_RPC_URL: `http://127.0.0.1:${rpcPort}` },
    });
    evidence.configEnv = {
      placeholder: "${PROBE_RPC_URL}",
      variable_was_set: true,
      supports_rpc_urls_env_expansion: !`${env.stdout}\n${env.stderr}`.includes("relative URL"),
      run: env,
    };
    return evidence;
  } finally {
    await stop(dev);
    await stop(rpc);
    await rm(workDir, { recursive: true, force: true });
  }
}

await mkdir(outDir, { recursive: true });
const cli = await cliEvidence();
const runs = [];
for (let index = 0; index < repeat; index += 1) {
  runs.push(
    fixedBaseUrl
      ? { http: await httpEvidence(fixedBaseUrl), guards: await guardEvidence(fixedBaseUrl) }
      : await localCapture(),
  );
}
const accepted = runs.every(
  (run) => JSON.stringify(normalize(run)) === JSON.stringify(normalize(runs[0])),
);
await writeEvidence("cli.json", cli);
await writeEvidence("http.json", runs[0].http);
await writeEvidence("guards.json", runs[0].guards);
if (runs[0].schema) await writeEvidence("schema.json", runs[0].schema);
if (runs[0].check) await writeEvidence("check-update.json", runs[0].check);
if (runs[0].configEnv) await writeEvidence("config-env.json", runs[0].configEnv);
if (runs[0].devFlags) await writeEvidence("dev-flags.json", runs[0].devFlags);
await writeEvidence("acceptance.json", {
  runs: repeat,
  identical_except_timestamps_and_volatile_metrics: accepted,
});
if (!accepted) process.exitCode = 1;
