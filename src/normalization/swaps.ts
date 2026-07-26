import { swapEventSchema, type SwapEvent } from "../schemas/large-swaps.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import { LSS_SCOPE } from "../scope/large-swaps.js";
import { parseDecimal } from "../sources/graph/decimal.js";

import { normalizeAddress } from "./address.js";
import { NormalizationError } from "./error.js";
import { swapEventIdentity } from "./identities.js";

const SIGNED_INTEGER_PATTERN = /^(?:0|-?[1-9]\d*)$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type LssThresholdToken =
  typeof LSS_SCOPE.tokens.weth.address | typeof LSS_SCOPE.tokens.usdc.address;

/**
 * Capability-neutral raw Uniswap V3 swap row consumed by LSS normalization.
 * The later Nuthatch adapter owns mapping its view rows into this shape.
 */
export interface RawLssSwapEvent {
  readonly chain_id: number;
  readonly protocol: string;
  readonly pool: string;
  readonly transaction_hash: string;
  readonly log_index: number;
  readonly block_number: number;
  readonly timestamp: number;
  readonly amount0_raw: string;
  readonly amount1_raw: string;
  readonly source_id: string;
}

function parseSignedInteger(value: string, field: string): bigint {
  if (!SIGNED_INTEGER_PATTERN.test(value)) {
    throw new NormalizationError(`${field} must be a canonical signed integer string`);
  }
  return BigInt(value);
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new NormalizationError(`${field} must be a non-negative integer`);
  }
}

function tokenWithChain(token: typeof LSS_SCOPE.tokens.weth | typeof LSS_SCOPE.tokens.usdc) {
  return {
    chain_id: BASE_CHAIN_ID,
    ...token,
  };
}

function formatBaseUnits(value: bigint, decimals: number): string {
  const digits = (value < 0n ? -value : value).toString();
  if (decimals === 0) {
    return digits;
  }

  const padded = digits.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, -decimals);
  const fractionalPart = padded.slice(-decimals).replace(/0+$/, "");
  return fractionalPart === "" ? integerPart : `${integerPart}.${fractionalPart}`;
}

function compareParsedDecimals(
  left: ReturnType<typeof parseDecimal>,
  right: ReturnType<typeof parseDecimal>,
): number {
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = BigInt(left.integerPart + left.fractionalPart.padEnd(scale, "0"));
  const rightScaled = BigInt(right.integerPart + right.fractionalPart.padEnd(scale, "0"));
  if (leftScaled === rightScaled) {
    return 0;
  }
  return leftScaled < rightScaled ? -1 : 1;
}

function validateRawScope(row: RawLssSwapEvent): {
  readonly pool: typeof LSS_SCOPE.poolAddress;
  readonly transactionHash: string;
} {
  if (row.chain_id !== BASE_CHAIN_ID) {
    throw new NormalizationError(`Unsupported swap chain: ${String(row.chain_id)}`);
  }
  if (row.protocol !== LSS_SCOPE.protocol) {
    throw new NormalizationError(`Unsupported swap protocol: ${row.protocol}`);
  }

  const pool = normalizeAddress(row.pool);
  if (pool !== LSS_SCOPE.poolAddress) {
    throw new NormalizationError(`Unsupported swap pool: ${pool}`);
  }
  if (!TRANSACTION_HASH_PATTERN.test(row.transaction_hash)) {
    throw new NormalizationError(`Invalid swap transaction hash: ${row.transaction_hash}`);
  }

  assertNonNegativeInteger(row.log_index, "log_index");
  assertNonNegativeInteger(row.block_number, "block_number");
  assertNonNegativeInteger(row.timestamp, "timestamp");
  if (row.source_id === "" || row.source_id.trim() !== row.source_id) {
    throw new NormalizationError("source_id must be non-empty without surrounding whitespace");
  }

  return {
    pool: LSS_SCOPE.poolAddress,
    transactionHash: row.transaction_hash.toLowerCase(),
  };
}

/**
 * Normalizes one raw Uniswap V3 pool-delta row into the LSS `SwapEvent`.
 *
 * Positive pool deltas are the input asset; negative pool deltas are the output
 * asset. Human amounts are exact absolute base-unit conversions using `BigInt`.
 */
export function normalizeLssSwapEvent(row: RawLssSwapEvent): SwapEvent {
  const { pool, transactionHash } = validateRawScope(row);
  const amount0 = parseSignedInteger(row.amount0_raw, "amount0_raw");
  const amount1 = parseSignedInteger(row.amount1_raw, "amount1_raw");

  if (amount0 === 0n || amount1 === 0n || amount0 > 0n === amount1 > 0n) {
    throw new NormalizationError("Swap pool deltas must be non-zero and have opposite signs");
  }

  const token0 = tokenWithChain(LSS_SCOPE.tokens.weth);
  const token1 = tokenWithChain(LSS_SCOPE.tokens.usdc);
  const token0IsInput = amount0 > 0n;
  const inputToken = token0IsInput ? token0 : token1;
  const outputToken = token0IsInput ? token1 : token0;
  const inputRaw = token0IsInput ? amount0 : amount1;
  const outputRaw = token0IsInput ? amount1 : amount0;

  const parsed = swapEventSchema.safeParse({
    chain_id: BASE_CHAIN_ID,
    protocol: LSS_SCOPE.protocol,
    pool,
    transaction_hash: transactionHash,
    log_index: row.log_index,
    block_number: row.block_number,
    timestamp: row.timestamp,
    asset_in: inputToken,
    asset_out: outputToken,
    amount_in: formatBaseUnits(inputRaw, inputToken.decimals),
    amount_out: formatBaseUnits(outputRaw, outputToken.decimals),
    amount_in_raw: inputRaw.toString(),
    amount_out_raw: outputRaw.toString(),
    usd_notional: null,
    source_id: row.source_id,
  });

  if (!parsed.success) {
    throw new NormalizationError("Normalized swap failed the canonical schema", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function stableSwapValue(event: SwapEvent): string {
  return JSON.stringify(event);
}

/**
 * Collapses exact duplicate events by chain + transaction hash + log index.
 * Conflicting rows with the same on-chain identity are rejected.
 */
export function deduplicateSwapEvents(events: readonly SwapEvent[]): SwapEvent[] {
  const byIdentity = new Map<string, SwapEvent>();

  for (const event of events) {
    const parsed = swapEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new NormalizationError("Cannot deduplicate an invalid canonical swap", {
        cause: parsed.error,
      });
    }

    const identity = swapEventIdentity(
      parsed.data.chain_id,
      parsed.data.transaction_hash,
      parsed.data.log_index,
    );
    const existing = byIdentity.get(identity);
    if (existing !== undefined && stableSwapValue(existing) !== stableSwapValue(parsed.data)) {
      throw new NormalizationError(`Conflicting swap rows share event identity: ${identity}`);
    }
    byIdentity.set(identity, parsed.data);
  }

  return [...byIdentity.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, event]) => event);
}

function assertThresholdToken(token: string): asserts token is LssThresholdToken {
  if (token !== LSS_SCOPE.tokens.weth.address && token !== LSS_SCOPE.tokens.usdc.address) {
    throw new NormalizationError(`Unsupported threshold token: ${token}`);
  }
}

function thresholdRawAmount(event: SwapEvent, thresholdToken: LssThresholdToken): bigint {
  const isInput =
    event.asset_in.address === thresholdToken
      ? true
      : event.asset_out.address === thresholdToken
        ? false
        : null;
  if (isInput === null) {
    throw new NormalizationError("Threshold token is absent from the canonical swap");
  }

  const raw = isInput ? event.amount_in_raw : event.amount_out_raw;
  if (raw === undefined) {
    throw new NormalizationError("Threshold comparison requires preserved raw token amounts");
  }

  const signed = parseSignedInteger(raw, isInput ? "amount_in_raw" : "amount_out_raw");
  if ((isInput && signed <= 0n) || (!isInput && signed >= 0n)) {
    throw new NormalizationError("Canonical swap raw signs disagree with token direction");
  }
  return signed < 0n ? -signed : signed;
}

function rawAmountAsHuman(rawAmount: bigint, thresholdToken: LssThresholdToken): string {
  const decimals =
    thresholdToken === LSS_SCOPE.tokens.weth.address
      ? LSS_SCOPE.tokens.weth.decimals
      : LSS_SCOPE.tokens.usdc.decimals;
  return formatBaseUnits(rawAmount, decimals);
}

/**
 * Compares the exact absolute selected-token pool delta to a positive human-unit
 * threshold. No JavaScript number conversion or USD pricing is used.
 */
export function swapMeetsTokenThreshold(
  event: SwapEvent,
  thresholdToken: string,
  minAmount: string,
): boolean {
  assertThresholdToken(thresholdToken);
  if (minAmount.trim() !== minAmount) {
    throw new NormalizationError("min_amount must not contain surrounding whitespace");
  }

  let threshold: ReturnType<typeof parseDecimal>;
  try {
    threshold = parseDecimal(minAmount);
  } catch (error) {
    throw new NormalizationError("min_amount must be a base-10 decimal string", {
      cause: error,
    });
  }
  if (threshold.canonical === "0") {
    throw new NormalizationError("min_amount must be positive");
  }

  const rawAmount = thresholdRawAmount(event, thresholdToken);
  const humanAmount = parseDecimal(rawAmountAsHuman(rawAmount, thresholdToken));
  return compareParsedDecimals(humanAmount, threshold) >= 0;
}

export function filterSwapsByTokenThreshold(
  events: readonly SwapEvent[],
  thresholdToken: string,
  minAmount: string,
): SwapEvent[] {
  return events.filter((event) => swapMeetsTokenThreshold(event, thresholdToken, minAmount));
}

/**
 * LSS-02 pipeline: normalize, collapse duplicate identities, then apply the exact
 * selected-token threshold. LSS-03 owns response ordering and pagination.
 */
export function normalizeDeduplicateAndFilterSwaps(
  rows: readonly RawLssSwapEvent[],
  thresholdToken: string,
  minAmount: string,
): SwapEvent[] {
  const normalized = rows.map(normalizeLssSwapEvent);
  const deduplicated = deduplicateSwapEvents(normalized);
  return filterSwapsByTokenThreshold(deduplicated, thresholdToken, minAmount);
}
