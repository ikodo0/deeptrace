import { z } from "zod";

import { deduplicateSwapEvents, filterSwapsByTokenThreshold } from "../normalization/index.js";
import {
  findLargeSwapsRequestSchema,
  type FindLargeSwapsRequest,
  type FindLargeSwapsRequestInput,
} from "../schemas/large-swaps-request.js";
import {
  largeSwapPaginationSchema,
  type LargeSwapPagination,
  type SwapEvent,
} from "../schemas/large-swaps.js";
import { LSS_SCOPE } from "../scope/large-swaps.js";

const CURSOR_PREFIX = `lss:v${String(LSS_SCOPE.cursor.version)}:`;
const VERSIONED_CURSOR_PATTERN = /^lss:v(\d+):(.+)$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0\.\d*[1-9]\d*|[1-9]\d*(?:\.\d+)?)$/;
const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "Must be a safe integer.");
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "Must be a safe integer.");

const cursorPayloadSchema = z
  .object({
    snapshot_head: nonNegativeSafeIntegerSchema,
    chain_id: positiveSafeIntegerSchema,
    pool_address: z.string().regex(ADDRESS_PATTERN),
    threshold_token: z.string().regex(ADDRESS_PATTERN),
    min_amount: z.string().regex(POSITIVE_DECIMAL_PATTERN),
    last_event: z
      .object({
        block_number: nonNegativeSafeIntegerSchema,
        log_index: nonNegativeSafeIntegerSchema,
        transaction_hash: z.string().regex(TRANSACTION_HASH_PATTERN),
      })
      .strict(),
  })
  .strict();

type LargeSwapCursorPayload = z.infer<typeof cursorPayloadSchema>;

export interface LargeSwapQueryPage {
  readonly snapshot_head: number;
  readonly swaps: SwapEvent[];
  readonly pagination: LargeSwapPagination;
}

export interface LargeSwapQueryInput {
  readonly events: readonly SwapEvent[];
  readonly indexedHead: number;
  readonly request: FindLargeSwapsRequestInput;
}

export class LargeSwapQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LargeSwapQueryError";
  }
}

export class LargeSwapCursorError extends LargeSwapQueryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LargeSwapCursorError";
  }
}

function parseRequest(rawRequest: FindLargeSwapsRequestInput): FindLargeSwapsRequest {
  const parsed = findLargeSwapsRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    throw new LargeSwapQueryError("Invalid find_large_swaps query request.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function assertIndexedHead(indexedHead: number): void {
  if (!Number.isSafeInteger(indexedHead) || indexedHead < 0) {
    throw new LargeSwapQueryError("Indexed head must be a non-negative safe integer.");
  }
}

function decodeCursor(cursor: string): LargeSwapCursorPayload {
  if (cursor.length > LSS_SCOPE.cursor.maximumLength) {
    throw new LargeSwapCursorError("Large-swap cursor exceeds the maximum length.");
  }

  const match = VERSIONED_CURSOR_PATTERN.exec(cursor);
  if (match === null) {
    throw new LargeSwapCursorError("Malformed large-swap cursor.");
  }

  const [, versionText, encoded] = match;
  if (versionText !== String(LSS_SCOPE.cursor.version)) {
    throw new LargeSwapCursorError("Unsupported large-swap cursor version.");
  }
  if (encoded === undefined || !BASE64URL_PATTERN.test(encoded)) {
    throw new LargeSwapCursorError("Malformed large-swap cursor.");
  }

  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      throw new Error("Cursor payload was not canonical base64url");
    }

    const json = bytes.toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== encoded) {
      throw new Error("Cursor payload was not valid UTF-8");
    }

    const parsed = cursorPayloadSchema.safeParse(JSON.parse(json) as unknown);
    if (!parsed.success) {
      throw parsed.error;
    }
    return parsed.data;
  } catch (error) {
    throw new LargeSwapCursorError("Malformed large-swap cursor.", { cause: error });
  }
}

function encodeCursor(payload: LargeSwapCursorPayload): string {
  const parsed = cursorPayloadSchema.parse(payload);
  const encoded = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  const cursor = `${CURSOR_PREFIX}${encoded}`;
  if (cursor.length > LSS_SCOPE.cursor.maximumLength) {
    throw new LargeSwapQueryError("Generated large-swap cursor exceeded the maximum length.");
  }
  return cursor;
}

function assertCursorScope(cursor: LargeSwapCursorPayload, request: FindLargeSwapsRequest): void {
  if (
    cursor.chain_id !== request.chain_id ||
    cursor.pool_address !== request.pool_address ||
    cursor.threshold_token !== request.threshold_token ||
    cursor.min_amount !== request.min_amount
  ) {
    throw new LargeSwapCursorError("Large-swap cursor does not match the request scope.");
  }
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Final LSS page order: block descending, log index descending, then transaction
 * hash ascending to make the plan's two-key order total and deterministic.
 */
export function compareSwapPageOrder(left: SwapEvent, right: SwapEvent): number {
  if (left.block_number !== right.block_number) {
    return left.block_number > right.block_number ? -1 : 1;
  }
  if (left.log_index !== right.log_index) {
    return left.log_index > right.log_index ? -1 : 1;
  }
  return compareStrings(left.transaction_hash, right.transaction_hash);
}

function cursorMatchesEvent(
  cursor: LargeSwapCursorPayload["last_event"],
  event: SwapEvent,
): boolean {
  return (
    cursor.block_number === event.block_number &&
    cursor.log_index === event.log_index &&
    cursor.transaction_hash === event.transaction_hash
  );
}

function nextCursor(
  request: FindLargeSwapsRequest,
  snapshotHead: number,
  event: SwapEvent,
): string {
  return encodeCursor({
    snapshot_head: snapshotHead,
    chain_id: request.chain_id,
    pool_address: request.pool_address,
    threshold_token: request.threshold_token,
    min_amount: request.min_amount,
    last_event: {
      block_number: event.block_number,
      log_index: event.log_index,
      transaction_hash: event.transaction_hash,
    },
  });
}

/**
 * Produces one deterministic fixed-snapshot page over canonical normalized swaps.
 *
 * The first page freezes `indexedHead`. Continuations retain that snapshot even
 * when the source advances, and fail if the source can no longer serve the frozen
 * head or cursor anchor.
 */
export function queryLargeSwapPage(input: LargeSwapQueryInput): LargeSwapQueryPage {
  const request = parseRequest(input.request);
  assertIndexedHead(input.indexedHead);

  const decodedCursor = request.cursor === null ? null : decodeCursor(request.cursor);
  if (decodedCursor !== null) {
    assertCursorScope(decodedCursor, request);
    if (input.indexedHead < decodedCursor.snapshot_head) {
      throw new LargeSwapCursorError("Large-swap source head is behind the cursor snapshot.");
    }
  }
  const snapshotHead = decodedCursor?.snapshot_head ?? input.indexedHead;

  const snapshotEvents = deduplicateSwapEvents(input.events).filter(
    (event) => event.block_number <= snapshotHead,
  );
  const ordered = filterSwapsByTokenThreshold(
    snapshotEvents,
    request.threshold_token,
    request.min_amount,
  ).sort(compareSwapPageOrder);

  let remaining = ordered;
  if (decodedCursor !== null) {
    const anchorIndex = ordered.findIndex((event) =>
      cursorMatchesEvent(decodedCursor.last_event, event),
    );
    if (anchorIndex < 0) {
      throw new LargeSwapCursorError(
        "Large-swap cursor anchor is unavailable in the frozen snapshot.",
      );
    }
    remaining = ordered.slice(anchorIndex + 1);
  }

  const swaps = remaining.slice(0, request.limit);
  const hasMore = remaining.length > swaps.length;
  const last = swaps.at(-1);
  const pagination = largeSwapPaginationSchema.parse({
    limit: request.limit,
    returned: swaps.length,
    has_more: hasMore,
    next_cursor: hasMore && last !== undefined ? nextCursor(request, snapshotHead, last) : null,
  });

  return {
    snapshot_head: snapshotHead,
    swaps,
    pagination,
  };
}
