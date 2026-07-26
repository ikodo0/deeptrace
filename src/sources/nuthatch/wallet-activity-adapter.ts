import { z } from "zod";

import { M0_CORE_POLICY } from "../../policy/index.js";
import type { NuthatchSourceRegistryRecord } from "../../registry/types.js";
import {
  walletActivitySchema,
  type ResultFreshness,
  type ResultProvenance,
  type WalletActivity,
} from "../../schemas/index.js";
import { BASE_CHAIN_ID } from "../../schemas/source-adapter.js";
import { WALLET_RESEARCH_SCOPE } from "../../scope/wallet-research.js";
import { normalizeLssSwapEvent } from "../../normalization/index.js";
import type {
  WalletActivityResult,
  WalletSourceFailureStatus,
} from "../../tools/wallet-sources.js";
import type { WalletResearchQueryContext } from "../../tools/wallet-query.js";

import type { NuthatchClient, NuthatchHttpResult } from "./client.js";
import { parseLargeSwapReady } from "./large-swaps-response.js";
import { parseNest, parseSchema } from "./response.js";
import {
  buildWalletActivityHeadQuery,
  buildWalletActivityQuery,
  NUTHATCH_WALLET_ACTIVITY_QUERY_ID,
  NUTHATCH_WALLET_ACTIVITY_VIEW,
} from "./wallet-activity-query.js";

const safeIntegerSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const signedIntegerSchema = z.string().regex(/^(?:0|-?[1-9]\d*)$/);
const rowSchema = z
  .object({
    pool_address: addressSchema,
    block_number: safeIntegerSchema,
    block_hash: hashSchema,
    block_timestamp: safeIntegerSchema,
    transaction_hash: hashSchema,
    log_index: safeIntegerSchema,
    sender: addressSchema,
    recipient: addressSchema,
    amount0_raw: signedIntegerSchema,
    amount1_raw: signedIntegerSchema,
  })
  .strict();
const receiptSchema = z
  .object({
    count: safeIntegerSchema,
    provenance: z
      .object({
        as_of: safeIntegerSchema,
        registry_hash: hashSchema,
      })
      .passthrough(),
    rows: z.array(rowSchema),
    truncated: z.boolean(),
  })
  .passthrough();

type WalletRow = z.infer<typeof rowSchema>;

export interface NuthatchWalletActivityDeps {
  readonly client: NuthatchClient;
  readonly clock: () => number;
  readonly record: NuthatchSourceRegistryRecord;
}

function provenance(record: NuthatchSourceRegistryRecord): ResultProvenance {
  return {
    source_id: record.source_id,
    source_type: record.source_type,
    protocol: record.protocol,
    chain_id: BASE_CHAIN_ID,
    deployment_or_view_id: record.deployment_or_view_id,
    schema_version: record.schema_version,
    methodology_version: record.methodology_version,
    query_id: NUTHATCH_WALLET_ACTIVITY_QUERY_ID,
  };
}

export function walletActivityProvenance(record: NuthatchSourceRegistryRecord): ResultProvenance {
  return provenance(record);
}

function failed(
  record: NuthatchSourceRegistryRecord,
  status: WalletSourceFailureStatus,
  warning: string,
): WalletActivityResult {
  return {
    status,
    activities: null,
    indexedHead: null,
    freshness: { source_id: record.source_id, status: "unavailable" },
    provenance: provenance(record),
    warnings: [warning],
  };
}

export function createWalletActivityFailure(
  record: NuthatchSourceRegistryRecord,
  status: WalletSourceFailureStatus,
  warning: string,
): WalletActivityResult {
  return failed(record, status, warning);
}

function httpStatus(result: Extract<NuthatchHttpResult, { ok: false }>) {
  return result.error.kind === "timeout" ? ("timeout" as const) : ("error" as const);
}

function parseReceipt(body: unknown, registryHash: string): readonly WalletRow[] | null {
  const parsed = receiptSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.truncated ||
    parsed.data.count !== parsed.data.rows.length ||
    parsed.data.provenance.registry_hash.toLowerCase() !== registryHash.toLowerCase() ||
    parsed.data.rows.some((row) => row.block_number > parsed.data.provenance.as_of)
  ) {
    return null;
  }
  return parsed.data.rows.map((row) => ({
    ...row,
    pool_address: row.pool_address.toLowerCase(),
    block_hash: row.block_hash.toLowerCase(),
    transaction_hash: row.transaction_hash.toLowerCase(),
    sender: row.sender.toLowerCase(),
    recipient: row.recipient.toLowerCase(),
  }));
}

function activityFromRow(row: WalletRow, wallet: string, sourceId: string): WalletActivity {
  const swap = normalizeLssSwapEvent({
    chain_id: BASE_CHAIN_ID,
    protocol: WALLET_RESEARCH_SCOPE.nuthatch.protocol,
    pool: row.pool_address,
    transaction_hash: row.transaction_hash,
    log_index: row.log_index,
    block_number: row.block_number,
    timestamp: row.block_timestamp,
    amount0_raw: row.amount0_raw,
    amount1_raw: row.amount1_raw,
    source_id: sourceId,
  });
  const recipientMatch = row.recipient === wallet;
  const counterparty = recipientMatch ? row.sender : row.recipient;
  return walletActivitySchema.parse({
    id: `${BASE_CHAIN_ID}:${swap.transaction_hash}:${String(swap.log_index)}`,
    chain_id: BASE_CHAIN_ID,
    wallet_address: wallet,
    protocol: WALLET_RESEARCH_SCOPE.nuthatch.protocol,
    activity_type: recipientMatch ? "swap_received" : "swap_sent",
    transaction_hash: swap.transaction_hash,
    log_index: swap.log_index,
    block_number: swap.block_number,
    timestamp: swap.timestamp,
    counterparty: counterparty === wallet ? null : counterparty,
    assets: [
      {
        token_address: swap.asset_in.address,
        symbol: swap.asset_in.symbol,
        decimals: swap.asset_in.decimals,
        role: "swap_in",
        raw_amount: swap.amount_in_raw!,
        normalized_amount: swap.amount_in,
        usd_price: null,
        usd_value: null,
      },
      {
        token_address: swap.asset_out.address,
        symbol: swap.asset_out.symbol,
        decimals: swap.asset_out.decimals,
        role: "swap_out",
        raw_amount: (-BigInt(swap.amount_out_raw!)).toString(),
        normalized_amount: swap.amount_out,
        usd_price: null,
        usd_value: null,
      },
    ],
    source_id: sourceId,
  });
}

function validRecord(record: NuthatchSourceRegistryRecord): boolean {
  return (
    record.source_id === WALLET_RESEARCH_SCOPE.nuthatch.sourceId &&
    record.status === "active" &&
    record.locator.view_id === NUTHATCH_WALLET_ACTIVITY_VIEW &&
    record.supported_entities.includes(NUTHATCH_WALLET_ACTIVITY_VIEW) &&
    record.methodology_version === WALLET_RESEARCH_SCOPE.nuthatch.methodologyVersion
  );
}

export async function fetchNuthatchWalletActivity(
  deps: NuthatchWalletActivityDeps,
  context: WalletResearchQueryContext,
): Promise<WalletActivityResult> {
  const { client, clock, record } = deps;
  if (!validRecord(record)) {
    return failed(record, "unsupported", "Wallet Nuthatch registry capability is unsupported.");
  }
  try {
    const readyResult = await client.ready();
    if (!readyResult.ok) {
      return failed(
        record,
        readyResult.status === 503 ? "stale" : httpStatus(readyResult),
        readyResult.status === 503
          ? "Nuthatch is not ready for wallet activity."
          : readyResult.error.message,
      );
    }
    const ready = parseLargeSwapReady(readyResult.body);
    if (ready === null || !ready.ready) {
      return failed(record, "stale", "Nuthatch wallet activity readiness is invalid.");
    }

    const [nestResult, schemaResult] = await Promise.all([client.nest(), client.schema()]);
    if (!nestResult.ok) {
      return failed(record, httpStatus(nestResult), nestResult.error.message);
    }
    if (!schemaResult.ok) {
      return failed(record, httpStatus(schemaResult), schemaResult.error.message);
    }
    const nest = parseNest(nestResult.body);
    const schema = parseSchema(schemaResult.body);
    if (!nest.ok || !schema.ok || nest.registryHash !== record.deployment_or_view_id) {
      return failed(
        record,
        "unsupported",
        "Nuthatch wallet metadata failed its registry contract.",
      );
    }

    const headResult = await client.sql(buildWalletActivityHeadQuery(context.snapshotHead), 1);
    if (!headResult.ok) {
      return failed(record, httpStatus(headResult), headResult.error.message);
    }
    const headRows = parseReceipt(headResult.body, record.deployment_or_view_id);
    const head = headRows?.[0];
    if (head === undefined || headRows?.length !== 1) {
      return failed(record, "unsupported", "Wallet activity head receipt is invalid.");
    }
    const snapshotHead = context.snapshotHead ?? head.block_number;
    if (snapshotHead > ready.indexedHead) {
      return failed(record, "unsupported", "Wallet activity source is behind the cursor snapshot.");
    }
    const windowSeconds = context.request.window === "24h" ? 86_400 : 604_800;
    const windowStart = Math.max(0, head.block_timestamp - windowSeconds);
    const activityResult = await client.sql(
      buildWalletActivityQuery(context, snapshotHead, windowStart),
      WALLET_RESEARCH_SCOPE.scan.maximumRows + 1,
    );
    if (!activityResult.ok) {
      return failed(record, httpStatus(activityResult), activityResult.error.message);
    }
    const rows = parseReceipt(activityResult.body, record.deployment_or_view_id);
    if (
      rows === null ||
      rows.length > WALLET_RESEARCH_SCOPE.scan.maximumRows ||
      rows.some(
        (row) =>
          row.sender !== context.request.address && row.recipient !== context.request.address,
      )
    ) {
      return failed(
        record,
        rows !== null && rows.length > WALLET_RESEARCH_SCOPE.scan.maximumRows
          ? "error"
          : "unsupported",
        rows !== null && rows.length > WALLET_RESEARCH_SCOPE.scan.maximumRows
          ? "Wallet activity window exceeded the bounded scan ceiling."
          : "Wallet activity receipt is invalid.",
      );
    }

    const queriedAt = clock();
    const lag = queriedAt - head.block_timestamp;
    if (!Number.isSafeInteger(lag) || lag < 0) {
      return failed(record, "unsupported", "Wallet activity freshness is invalid.");
    }
    if (lag > M0_CORE_POLICY.freshness.qualityStaleAfterSeconds) {
      return failed(record, "stale", "Wallet activity source is stale.");
    }
    const freshness: ResultFreshness = {
      source_id: record.source_id,
      status: "fresh",
      indexed_block: head.block_number,
      indexed_block_timestamp: head.block_timestamp,
      indexed_block_hash: head.block_hash,
      queried_at: queriedAt,
      lag_seconds: lag,
    };
    return {
      status: "ok",
      activities: rows.map((row) =>
        activityFromRow(row, context.request.address, record.source_id),
      ),
      indexedHead: head.block_number,
      freshness,
      provenance: provenance(record),
      warnings: [],
    };
  } catch {
    return failed(
      record,
      "error",
      "Wallet Nuthatch adapter failed unexpectedly; details were redacted.",
    );
  }
}
