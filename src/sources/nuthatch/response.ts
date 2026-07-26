import type { NuthatchFreshnessData } from "../../schemas/source-adapter.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Failure kinds the response parsers can emit. `shape` covers schema drift
 * (renamed/missing/extra columns, wrong types); the adapter maps `shape` to
 * `unsupported`, never to `error`. `empty` and `multi` are row-count drift.
 */
export type FreshnessParseFailureKind = "empty" | "multi" | "shape";

export interface FreshnessParseFailure {
  readonly kind: FreshnessParseFailureKind;
  readonly message: string;
}

export type FreshnessParseResult =
  | { readonly ok: true; readonly row: NuthatchFreshnessData }
  | { readonly ok: false; readonly failure: FreshnessParseFailure };

export interface NestParseFailure {
  readonly kind: "shape";
  readonly message: string;
}

export type NestParseResult =
  | {
      readonly ok: true;
      readonly registryHash: string;
      readonly nestName: string | null;
      readonly tableCount: number | null;
    }
  | { readonly ok: false; readonly failure: NestParseFailure };

export interface SchemaParseFailure {
  readonly kind: "shape";
  readonly message: string;
}

export type SchemaParseResult =
  | { readonly ok: true; readonly schemaText: string; readonly schemaVersion: string | null }
  | { readonly ok: false; readonly failure: SchemaParseFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function failShape(message: string): {
  readonly ok: false;
  readonly failure: { kind: "shape"; message: string };
} {
  return { ok: false, failure: { kind: "shape", message } };
}

/**
 * Parses the Nuthatch `/sql` envelope for the fixed freshness query. The
 * envelope is `{ count, provenance, rows: [...], truncated }`; only `rows`
 * is load-bearing for the freshness contract. Exactly one row is required.
 */
export function parseFreshnessRows(body: unknown): FreshnessParseResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      failure: { kind: "shape", message: "Freshness /sql body is not an object." },
    };
  }

  const rows = body.rows;
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      failure: { kind: "shape", message: "Freshness /sql body is missing a rows array." },
    };
  }
  const rowList = rows as readonly unknown[];

  if (rowList.length === 0) {
    return { ok: false, failure: { kind: "empty", message: "Freshness /sql returned zero rows." } };
  }

  if (rowList.length > 1) {
    return {
      ok: false,
      failure: {
        kind: "multi",
        message: `Freshness /sql returned ${String(rowList.length)} rows; expected exactly one.`,
      },
    };
  }

  const raw = rowList[0];
  if (raw === undefined || !isRecord(raw)) {
    return { ok: false, failure: { kind: "shape", message: "Freshness row is not an object." } };
  }

  const poolAddress = raw.pool_address;
  if (typeof poolAddress !== "string" || !ADDRESS_RE.test(poolAddress)) {
    return failShape("Freshness row pool_address must be a 20-byte hex string.");
  }

  const lastSwapBlockHash = raw.last_swap_block_hash;
  if (typeof lastSwapBlockHash !== "string" || !HASH_RE.test(lastSwapBlockHash)) {
    return failShape("Freshness row last_swap_block_hash must be a 32-byte hex string.");
  }

  const lastSwapTxHash = raw.last_swap_tx_hash;
  if (typeof lastSwapTxHash !== "string" || !HASH_RE.test(lastSwapTxHash)) {
    return failShape("Freshness row last_swap_tx_hash must be a 32-byte hex string.");
  }

  const recentSwapCount = raw.recent_swap_count_24h;
  if (!isNonNegativeSafeInt(recentSwapCount)) {
    return failShape("Freshness row recent_swap_count_24h must be a non-negative safe integer.");
  }

  const lastSwapBlock = raw.last_swap_block;
  if (!isNonNegativeSafeInt(lastSwapBlock)) {
    return failShape("Freshness row last_swap_block must be a non-negative safe integer.");
  }

  const lastSwapBlockTimestamp = raw.last_swap_block_timestamp;
  if (!isNonNegativeSafeInt(lastSwapBlockTimestamp)) {
    return failShape(
      "Freshness row last_swap_block_timestamp must be a non-negative safe integer.",
    );
  }

  const lastSwapLogIndex = raw.last_swap_log_index;
  if (!isNonNegativeSafeInt(lastSwapLogIndex)) {
    return failShape("Freshness row last_swap_log_index must be a non-negative safe integer.");
  }

  const row: NuthatchFreshnessData = {
    pool_address: normalizeHex(poolAddress),
    recent_swap_count_24h: recentSwapCount,
    last_swap_block: lastSwapBlock,
    last_swap_block_timestamp: lastSwapBlockTimestamp,
    last_swap_block_hash: normalizeHex(lastSwapBlockHash),
    last_swap_tx_hash: normalizeHex(lastSwapTxHash),
    last_swap_log_index: lastSwapLogIndex,
  };

  return { ok: true, row };
}

/**
 * Parses `/nest`. Only `registry_hash` is load-bearing for the M5 contract;
 * `name` and `table_count` are retained as diagnostic context for warnings.
 */
export function parseNest(body: unknown): NestParseResult {
  if (!isRecord(body)) {
    return { ok: false, failure: { kind: "shape", message: "Nest body is not an object." } };
  }

  const registryHash = body.registry_hash;
  if (typeof registryHash !== "string" || !HASH_RE.test(registryHash)) {
    return {
      ok: false,
      failure: { kind: "shape", message: "Nest registry_hash must be a 32-byte hex string." },
    };
  }

  const nestName = typeof body.name === "string" && body.name.trim() !== "" ? body.name : null;
  const tableCount = isNonNegativeSafeInt(body.table_count) ? body.table_count : null;

  return {
    ok: true,
    registryHash: normalizeHex(registryHash),
    nestName,
    tableCount,
  };
}

/**
 * Parses `/schema`. In Nuthatch 0.6.1 the endpoint returns a plain-text
 * data-model document with no published version field; the parser accepts any
 * non-empty string and reports `schemaVersion: null` unless A2 later exposes
 * a version key. A non-string or empty body is shape drift → `unsupported`.
 */
export function parseSchema(body: unknown): SchemaParseResult {
  if (typeof body !== "string") {
    return { ok: false, failure: { kind: "shape", message: "Schema body must be a string." } };
  }

  if (body.trim() === "") {
    return { ok: false, failure: { kind: "shape", message: "Schema body is empty." } };
  }

  return { ok: true, schemaText: body, schemaVersion: null };
}
