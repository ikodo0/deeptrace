import { z } from "zod";

import {
  researchWalletRequestSchema,
  type ResearchWalletRequest,
  type ResearchWalletRequestInput,
  type WalletActivity,
  type WalletResearchPagination,
} from "../schemas/index.js";
import { WALLET_RESEARCH_SCOPE } from "../scope/wallet-research.js";

const CURSOR_PREFIX = `wr:v${String(WALLET_RESEARCH_SCOPE.cursor.version)}:`;
const CURSOR_PATTERN = /^wr:v(\d+):([A-Za-z0-9_-]+)$/;
const hashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

const cursorPayloadSchema = z
  .object({
    snapshot_head: z.number().int().nonnegative(),
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
    window: z.enum(WALLET_RESEARCH_SCOPE.windows),
    last_event: z
      .object({
        block_number: z.number().int().nonnegative(),
        log_index: z.number().int().nonnegative(),
        transaction_hash: hashSchema,
      })
      .strict(),
  })
  .strict();

type WalletCursorPayload = z.infer<typeof cursorPayloadSchema>;

export interface WalletEventPosition {
  readonly block_number: number;
  readonly log_index: number;
  readonly transaction_hash: string;
}

export interface WalletResearchQueryContext {
  readonly request: ResearchWalletRequest;
  readonly snapshotHead: number | null;
  readonly lastEvent: WalletEventPosition | null;
}

export class WalletResearchQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WalletResearchQueryError";
  }
}

function decodeCursor(cursor: string): WalletCursorPayload {
  const match = CURSOR_PATTERN.exec(cursor);
  if (match === null || match[1] !== String(WALLET_RESEARCH_SCOPE.cursor.version)) {
    throw new WalletResearchQueryError("Malformed or unsupported wallet cursor.");
  }
  try {
    const encoded = match[2]!;
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      throw new Error("Non-canonical base64url");
    }
    return cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error) {
    throw new WalletResearchQueryError("Malformed wallet cursor.", { cause: error });
  }
}

function encodeCursor(payload: WalletCursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(cursorPayloadSchema.parse(payload)), "utf8").toString(
    "base64url",
  );
  const cursor = `${CURSOR_PREFIX}${encoded}`;
  if (cursor.length > WALLET_RESEARCH_SCOPE.cursor.maximumLength) {
    throw new WalletResearchQueryError("Generated wallet cursor exceeds the maximum length.");
  }
  return cursor;
}

export function inspectWalletResearchQuery(
  input: ResearchWalletRequestInput,
): WalletResearchQueryContext {
  const parsed = researchWalletRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new WalletResearchQueryError("Invalid research_wallet request.", {
      cause: parsed.error,
    });
  }
  const cursor = parsed.data.cursor === null ? null : decodeCursor(parsed.data.cursor);
  if (
    cursor !== null &&
    (cursor.address !== parsed.data.address || cursor.window !== parsed.data.window)
  ) {
    throw new WalletResearchQueryError("Wallet cursor does not match the request scope.");
  }
  return {
    request: parsed.data,
    snapshotHead: cursor?.snapshot_head ?? null,
    lastEvent: cursor?.last_event ?? null,
  };
}

function compareEventPosition(left: WalletEventPosition, right: WalletEventPosition): number {
  if (left.block_number !== right.block_number) {
    return left.block_number > right.block_number ? -1 : 1;
  }
  if (left.log_index !== right.log_index) {
    return left.log_index > right.log_index ? -1 : 1;
  }
  return left.transaction_hash.localeCompare(right.transaction_hash);
}

export function paginateWalletActivity(
  context: WalletResearchQueryContext,
  activities: readonly WalletActivity[],
  indexedHead: number,
): { readonly activities: WalletActivity[]; readonly pagination: WalletResearchPagination } {
  if (!Number.isSafeInteger(indexedHead) || indexedHead < 0) {
    throw new WalletResearchQueryError("Wallet activity indexed head is invalid.");
  }
  const snapshotHead = context.snapshotHead ?? indexedHead;
  if (indexedHead < snapshotHead) {
    throw new WalletResearchQueryError("Wallet activity source is behind the cursor snapshot.");
  }

  const identities = new Set<string>();
  let ordered = activities
    .filter(
      (activity) =>
        activity.wallet_address === context.request.address &&
        activity.block_number <= snapshotHead,
    )
    .filter((activity) => {
      const identity = `${activity.transaction_hash}:${String(activity.log_index)}`;
      if (identities.has(identity)) {
        return false;
      }
      identities.add(identity);
      return true;
    })
    .sort(compareEventPosition);

  if (context.lastEvent !== null) {
    ordered = ordered.filter((activity) => compareEventPosition(activity, context.lastEvent!) > 0);
  }

  const page = ordered.slice(0, context.request.limit);
  const hasMore = ordered.length > page.length;
  const last = page.at(-1);
  return {
    activities: page,
    pagination: {
      limit: context.request.limit,
      returned: page.length,
      has_more: hasMore,
      next_cursor:
        hasMore && last !== undefined
          ? encodeCursor({
              snapshot_head: snapshotHead,
              address: context.request.address,
              window: context.request.window,
              last_event: {
                block_number: last.block_number,
                log_index: last.log_index,
                transaction_hash: last.transaction_hash,
              },
            })
          : null,
    },
  };
}
