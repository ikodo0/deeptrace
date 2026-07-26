#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateProgress,
  parseReadyPayload,
  parseWatchdogState,
  positiveIntegerSetting,
} from "./nuthatch-watchdog-lib.mjs";

const DEFAULT_READY_URL = "http://127.0.0.1:8288/ready";
const DEFAULT_STATE_FILE = "/var/lib/nuthatch/.deeptrace-watchdog-state.json";
const DEFAULT_STALL_AFTER_SECONDS = 600;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_READY_BYTES = 32 * 1024;

function readyUrl(value) {
  const url = new URL(value ?? DEFAULT_READY_URL);
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (
    !loopback ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/ready" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("NUTHATCH_WATCHDOG_READY_URL must be a credential-free loopback /ready URL.");
  }
  return url;
}

async function fetchReady(url, timeoutMs) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Nuthatch /ready returned HTTP ${String(response.status)}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_READY_BYTES) {
    throw new Error("Nuthatch /ready response exceeded the byte ceiling.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_READY_BYTES) {
    throw new Error("Nuthatch /ready response exceeded the byte ceiling.");
  }
  try {
    return parseReadyPayload(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Nuthatch /ready returned invalid JSON.", { cause: error });
    }
    throw error;
  }
}

async function loadState(stateFile) {
  try {
    return parseWatchdogState(JSON.parse(await readFile(stateFile, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, stateFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

function safeFailure(error) {
  const known =
    error instanceof Error &&
    (error.message.startsWith("NUTHATCH_WATCHDOG_") ||
      error.message.startsWith("Nuthatch /ready") ||
      error.message.startsWith("/ready") ||
      error.message.startsWith("Watchdog"));
  return {
    event: "nuthatch_backfill_watchdog",
    status: "error",
    reason: known ? error.message : "Nuthatch /ready request failed; details were redacted.",
  };
}

try {
  const url = readyUrl(process.env.NUTHATCH_WATCHDOG_READY_URL);
  const stateFile = process.env.NUTHATCH_WATCHDOG_STATE_FILE ?? DEFAULT_STATE_FILE;
  const stallAfterSeconds = positiveIntegerSetting(
    process.env.NUTHATCH_WATCHDOG_STALL_AFTER_SECONDS,
    DEFAULT_STALL_AFTER_SECONDS,
    "NUTHATCH_WATCHDOG_STALL_AFTER_SECONDS",
  );
  const timeoutMs = positiveIntegerSetting(
    process.env.NUTHATCH_WATCHDOG_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    "NUTHATCH_WATCHDOG_TIMEOUT_MS",
  );
  const sample = await fetchReady(url, timeoutMs);
  const previous = await loadState(stateFile);
  const outcome = evaluateProgress(
    previous,
    sample,
    Math.floor(Date.now() / 1000),
    stallAfterSeconds,
  );
  await saveState(stateFile, outcome.state);
  console.log(JSON.stringify(outcome.report));
  process.exitCode = outcome.report.status === "alert" ? 2 : 0;
} catch (error) {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
}
