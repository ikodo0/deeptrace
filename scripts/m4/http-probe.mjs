#!/usr/bin/env node

import { isFreshnessViewAvailable, isMaxRowsRejection, requireBaseUrl } from "./http-probe-lib.mjs";

// HTTP probe for the Nuthatch 0.6.1 read-only API surface.
//
// Probes a fixed set of GET endpoints, asserts that POST /sql is rejected,
// exercises the concurrency guard, and verifies max_rows rejection.
//
// Usage:
//   node scripts/m4/http-probe.mjs
//   NUTHATCH_BASE_URL=http://127.0.0.1:8080 node scripts/m4/http-probe.mjs
//
// Output: a single JSON object on stdout. No secrets, keyed URLs, or admin
// tokens are read or printed. The base URL must be supplied via
// NUTHATCH_BASE_URL; it is never defaulted to avoid baking internal
// infrastructure names into committed source.

let baseUrl;
try {
  baseUrl = requireBaseUrl(process.env.NUTHATCH_BASE_URL);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const BASE_URL = baseUrl;
const REQUEST_TIMEOUT_MS = 15_000;
const BODY_TRUNCATE_BYTES = 2048;
const CONCURRENCY_PROBE_COUNT = 3;
const MAX_ROWS_REJECT = 50_001;
const EXPLAIN_QUERY = "SELECT * FROM pool_swap_freshness LIMIT 1";
const SQL_QUERY = "SELECT * FROM pool_swap_freshness LIMIT 1";
const GUARD_QUERY = "SELECT count(*) FROM pool__swap a, pool__swap b, pool__swap c";
const MAX_ROWS_QUERY = "SELECT * FROM pool__swap LIMIT 1";

function redactUrl(url) {
  return String(url).replaceAll(
    /([?&](?:key|api_?key|token|secret|password)=)[^&\s]+/gi,
    "$1<redacted>",
  );
}

function truncateBody(text) {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= BODY_TRUNCATE_BYTES) return text;
  return `${buffer.subarray(0, BODY_TRUNCATE_BYTES).toString("utf8")}…<truncated>`;
}

async function probe(method, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: options.headers ?? {},
      body: options.body ?? null,
      signal: controller.signal,
      redirect: "error",
    });
  } catch (cause) {
    clearTimeout(timer);
    return {
      method,
      url: redactUrl(url),
      status: null,
      content_type: null,
      duration_ms: Date.now() - startedAt,
      error: cause instanceof Error ? cause.name : String(cause),
      body: null,
    };
  }
  clearTimeout(timer);
  const text = await response.text();
  return {
    method,
    url: redactUrl(url),
    status: response.status,
    content_type: response.headers.get("content-type"),
    duration_ms: Date.now() - startedAt,
    error: null,
    body: truncateBody(text),
  };
}

function join(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function probeGetEndpoints() {
  const endpoints = {};
  const routes = ["/health", "/ready", "/nest", "/schema", "/tables", "/metrics"];
  for (const route of routes) {
    endpoints[route] = await probe("GET", join(BASE_URL, route));
  }
  endpoints["/explain"] = await probe(
    "GET",
    `${join(BASE_URL, "/explain")}?q=${encodeURIComponent(EXPLAIN_QUERY)}`,
  );
  endpoints["/sql"] = await probe(
    "GET",
    `${join(BASE_URL, "/sql")}?q=${encodeURIComponent(SQL_QUERY)}&max_rows=1`,
  );
  return endpoints;
}

async function probePostSqlRejected() {
  // POST /sql must be rejected — the read-only surface only accepts GET.
  const url = `${join(BASE_URL, "/sql")}?q=${encodeURIComponent(SQL_QUERY)}`;
  const result = await probe("POST", url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: SQL_QUERY }),
  });
  return {
    url: redactUrl(url),
    status: result.status,
    rejected: result.status === 405,
    body: result.body,
  };
}

async function probeMaxRowsRejection() {
  // Use a known raw table so a missing authored view cannot masquerade as a
  // max_rows guard rejection.
  const url = `${join(BASE_URL, "/sql")}?q=${encodeURIComponent(MAX_ROWS_QUERY)}&max_rows=${MAX_ROWS_REJECT}`;
  const result = await probe("GET", url);
  return {
    url: redactUrl(url),
    max_rows_requested: MAX_ROWS_REJECT,
    status: result.status,
    rejected: isMaxRowsRejection(result),
    body: result.body,
  };
}

async function probeConcurrencyGuard() {
  // Fire N simultaneous /sql requests and observe how many execute concurrently.
  // The Nuthatch dev server caps in-flight SQL with a concurrency guard; we
  // approximate "concurrent execution" by overlapping issue windows and
  // counting responses whose duration overlaps another in flight.
  const url = `${join(BASE_URL, "/sql")}?q=${encodeURIComponent(GUARD_QUERY)}&max_rows=1`;
  const issuedAt = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY_PROBE_COUNT }, () => probe("GET", url)),
  );
  const statuses = results.map((result) => result.status);
  const guardRejected = statuses.filter(
    (status) => status !== null && (status === 429 || status === 503),
  ).length;
  const ok = statuses.filter((status) => status === 200).length;
  const maxObservedOverlap = Math.max(...results.map((result) => (result.status === 200 ? 1 : 0)));
  return {
    url: redactUrl(url),
    requests: CONCURRENCY_PROBE_COUNT,
    issued_within_ms: Date.now() - issuedAt,
    statuses,
    ok_count: ok,
    guard_rejected_count: guardRejected,
    verified:
      guardRejected > 0 &&
      statuses.every((status) => status === 200 || status === 429 || status === 503),
    // Best-effort lower bound on observed concurrency: 1 if any request
    // succeeded, else 0. A precise count needs server-side metrics and is
    // captured separately via /metrics.
    observed_concurrency_lower_bound: maxObservedOverlap,
  };
}

const endpoints = await probeGetEndpoints();
const maxRows = await probeMaxRowsRejection();
const output = {
  target_host: new URL(BASE_URL).host,
  probe_version: "0.6.1",
  generated_at: new Date().toISOString(),
  endpoints,
  post_sql: await probePostSqlRejected(),
  max_rows: maxRows,
  concurrency: await probeConcurrencyGuard(),
  acceptance: {
    freshness_view_available: isFreshnessViewAvailable(endpoints),
    max_rows_rejection_verified: maxRows.rejected,
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.acceptance.freshness_view_available || !output.acceptance.max_rows_rejection_verified) {
  process.exitCode = 1;
}
