import type { SourceFreshness, TokenMetadata } from "../../schemas/source-adapter.js";

/**
 * Shape parsing shared by every Graph adapter.
 *
 * Gateway responses are untrusted input: nothing here asserts a shape, and a
 * value that fails validation becomes `null` so the calling adapter can report
 * a non-`ok` status instead of publishing a half-parsed fact.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const NON_NEGATIVE_INT_STRING = /^(?:0|[1-9]\d*)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAddress(value: string): string | null {
  if (!ADDRESS_PATTERN.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

/** Accepts only canonical non-negative USD decimal strings, never a number. */
export function parseFinancial(raw: unknown): string | null {
  if (typeof raw !== "string" || !NON_NEGATIVE_DECIMAL.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * Token decimals arrive as a string on native subgraphs and as an Int on
 * Messari standardized subgraphs, so both encodings are accepted here.
 */
function parseDecimals(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string" || !NON_NEGATIVE_INT_STRING.test(raw)) {
    return null;
  }
  const decimals = Number(raw);
  return Number.isSafeInteger(decimals) && decimals >= 0 ? decimals : null;
}

export function parseToken(raw: unknown): TokenMetadata | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.id !== "string" || typeof raw.symbol !== "string") {
    return null;
  }
  const address = normalizeAddress(raw.id);
  const symbol = raw.symbol.trim();
  const decimals = parseDecimals(raw.decimals);
  if (address === null || symbol === "" || decimals === null) {
    return null;
  }
  return { address, symbol, decimals };
}

export function parseFreshness(
  meta: Record<string, unknown>,
  queriedAt: number,
): SourceFreshness | null {
  if (!isRecord(meta.block)) {
    return null;
  }
  const block = meta.block;
  if (
    typeof block.number !== "number" ||
    !Number.isInteger(block.number) ||
    block.number < 0 ||
    typeof block.timestamp !== "number" ||
    !Number.isInteger(block.timestamp) ||
    block.timestamp < 0
  ) {
    return null;
  }

  const freshness: SourceFreshness = {
    indexed_block: block.number,
    indexed_block_timestamp: block.timestamp,
    queried_at: queriedAt,
  };

  if (typeof block.hash === "string" && BLOCK_HASH_PATTERN.test(block.hash)) {
    freshness.indexed_block_hash = block.hash.toLowerCase();
  }

  if (typeof meta.hasIndexingErrors === "boolean") {
    freshness.has_indexing_errors = meta.hasIndexingErrors;
  }

  return freshness;
}

/**
 * Resolves the Graph gateway credential from an explicit option first so tests
 * never depend on ambient environment, then from the environment.
 */
export function resolveGraphApiKey(options: {
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): string | null {
  if (options.apiKey !== undefined && options.apiKey.trim() !== "") {
    return options.apiKey;
  }
  const fromEnv = (options.env ?? process.env).GRAPH_API_KEY;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv;
  }
  return null;
}

export { NON_NEGATIVE_DECIMAL, NON_NEGATIVE_INT_STRING };
