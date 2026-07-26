import { z } from "zod";

import { M0_CORE_POLICY } from "../../policy/index.js";
import type { GraphSourceRegistryRecord } from "../../registry/types.js";
import {
  defiPositionSchema,
  type DeFiPosition,
  type ResultFreshness,
  type ResultProvenance,
} from "../../schemas/index.js";
import type { ResearchWalletRequest } from "../../schemas/wallet-research-request.js";
import { BASE_CHAIN_ID } from "../../schemas/source-adapter.js";
import { WALLET_RESEARCH_SCOPE } from "../../scope/wallet-research.js";
import type { WalletGraphResult, WalletSourceFailureStatus } from "../../tools/wallet-sources.js";

import { postGraphGateway } from "./transport.js";

export const WALLET_POSITIONS_QUERY = `query WalletPositions($wallet: String!, $limit: Int!) {
  _meta {
    block { number timestamp hash }
    hasIndexingErrors
    deployment
  }
  lendingProtocols(first: 1) {
    schemaVersion
    methodologyVersion
    network
  }
  positions(
    first: $limit
    orderBy: id
    orderDirection: asc
    where: { account: $wallet, balance_gt: "0" }
  ) {
    id
    account { id }
    market { id name }
    asset { id symbol decimals }
    side
    type
    isCollateral
    balance
    blockNumberOpened
    timestampOpened
    snapshots(first: 1, orderBy: blockNumber, orderDirection: desc) {
      balance
      balanceUSD
      blockNumber
      timestamp
    }
  }
}`;

const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const integerStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
const decimalStringSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const graphPayloadSchema = z
  .object({
    _meta: z
      .object({
        block: z
          .object({
            number: z.number().int().nonnegative(),
            timestamp: z.number().int().nonnegative(),
            hash: hashSchema.nullable().optional(),
          })
          .passthrough(),
        hasIndexingErrors: z.boolean().optional(),
        deployment: z.string().min(1),
      })
      .passthrough(),
    lendingProtocols: z
      .array(
        z
          .object({
            schemaVersion: z.string().min(1),
            methodologyVersion: z.string().min(1),
            network: z.literal("BASE"),
          })
          .passthrough(),
      )
      .length(1),
    positions: z.array(
      z
        .object({
          id: z.string().min(1),
          account: z.object({ id: addressSchema }).passthrough(),
          market: z
            .object({
              id: addressSchema,
              name: z.string().min(1).nullable(),
            })
            .passthrough(),
          asset: z
            .object({
              id: addressSchema,
              symbol: z.string().min(1),
              decimals: z.number().int().nonnegative().max(255),
            })
            .passthrough(),
          side: z.enum(["COLLATERAL", "BORROWER"]),
          type: z.string().nullable(),
          isCollateral: z.boolean().nullable(),
          balance: integerStringSchema,
          blockNumberOpened: integerStringSchema,
          timestampOpened: integerStringSchema,
          snapshots: z.array(
            z
              .object({
                balance: integerStringSchema,
                balanceUSD: decimalStringSchema.nullable(),
                blockNumber: integerStringSchema,
                timestamp: integerStringSchema,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function provenance(record: GraphSourceRegistryRecord): ResultProvenance {
  return {
    source_id: record.source_id,
    source_type: record.source_type,
    protocol: record.protocol,
    chain_id: BASE_CHAIN_ID,
    deployment_or_view_id: record.deployment_or_view_id,
    schema_version: record.schema_version,
    methodology_version: record.methodology_version,
    query_id: WALLET_RESEARCH_SCOPE.graph.queryId,
  };
}

export function walletGraphProvenance(record: GraphSourceRegistryRecord): ResultProvenance {
  return provenance(record);
}

function failure(
  record: GraphSourceRegistryRecord,
  status: WalletSourceFailureStatus,
  warning: string,
): WalletGraphResult {
  return {
    status,
    positions: null,
    freshness: { source_id: record.source_id, status: "unavailable" },
    provenance: provenance(record),
    warnings: [warning],
  };
}

function baseUnits(raw: string, decimals: number): string {
  const padded = raw.padStart(decimals + 1, "0");
  if (decimals === 0) {
    return padded;
  }
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function mapPosition(
  raw: z.infer<typeof graphPayloadSchema>["positions"][number],
  record: GraphSourceRegistryRecord,
): DeFiPosition {
  const snapshot = raw.snapshots[0];
  const collateral = raw.side === "COLLATERAL" && raw.isCollateral !== false;
  const positionType =
    raw.side === "BORROWER"
      ? "lending_borrow"
      : collateral
        ? "lending_collateral"
        : "lending_supply";
  const role = raw.side === "BORROWER" ? "borrowed" : collateral ? "collateral" : "supplied";
  const observedBlock = Number(snapshot?.blockNumber ?? raw.blockNumberOpened);
  const observedTimestamp = Number(snapshot?.timestamp ?? raw.timestampOpened);
  const rawAmount = snapshot?.balance ?? raw.balance;

  return defiPositionSchema.parse({
    id: raw.id,
    chain_id: BASE_CHAIN_ID,
    protocol: WALLET_RESEARCH_SCOPE.graph.protocol,
    position_type: positionType,
    container: {
      address: raw.market.id.toLowerCase(),
      name: raw.market.name,
    },
    assets: [
      {
        token_address: raw.asset.id.toLowerCase(),
        symbol: raw.asset.symbol,
        decimals: raw.asset.decimals,
        role,
        raw_amount: rawAmount,
        normalized_amount: baseUnits(rawAmount, raw.asset.decimals),
        usd_price: null,
        usd_value: snapshot?.balanceUSD ?? null,
      },
    ],
    valuation: {
      usd_value: snapshot?.balanceUSD ?? null,
    },
    observed_at: {
      block_number: observedBlock,
      timestamp: observedTimestamp,
    },
    source_ids: [record.source_id],
  });
}

export interface FetchWalletGraphOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly nowSeconds?: number;
  readonly gatewayOrigin?: string;
}

export async function fetchWalletGraphPositions(
  record: GraphSourceRegistryRecord,
  request: ResearchWalletRequest,
  options: FetchWalletGraphOptions = {},
): Promise<WalletGraphResult> {
  if (
    record.source_id !== WALLET_RESEARCH_SCOPE.graph.sourceId ||
    record.category !== "lending" ||
    record.status !== "active" ||
    record.locator.subgraph_id !== WALLET_RESEARCH_SCOPE.graph.subgraphId ||
    !record.supported_entities.includes("positions")
  ) {
    return failure(record, "unsupported", "Wallet Graph registry capability is unsupported.");
  }
  const apiKey = options.apiKey ?? process.env.GRAPH_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return failure(
      record,
      "error",
      "Wallet Graph source is unavailable because GRAPH_API_KEY is unset.",
    );
  }

  const transport = await postGraphGateway(
    record.locator.subgraph_id,
    WALLET_POSITIONS_QUERY,
    { wallet: request.address, limit: request.limit + 1 },
    {
      apiKey,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.gatewayOrigin !== undefined ? { gatewayOrigin: options.gatewayOrigin } : {}),
    },
  );
  if (transport.error !== null) {
    return failure(
      record,
      transport.error.kind === "timeout" ? "timeout" : "error",
      transport.error.message,
    );
  }
  const body = z
    .object({ data: z.unknown(), errors: z.array(z.unknown()).optional() })
    .passthrough()
    .safeParse(transport.body);
  if (!body.success || (body.data.errors?.length ?? 0) > 0) {
    return failure(record, "error", "Wallet Graph query returned errors.");
  }
  const parsed = graphPayloadSchema.safeParse(body.data.data);
  const protocol = parsed.success ? parsed.data.lendingProtocols[0] : undefined;
  if (
    !parsed.success ||
    parsed.data._meta.deployment !== record.deployment_or_view_id ||
    protocol?.schemaVersion !== record.schema_version ||
    protocol?.methodologyVersion !== record.methodology_version ||
    parsed.data.positions.some(({ account }) => account.id.toLowerCase() !== request.address)
  ) {
    return failure(
      record,
      "unsupported",
      "Wallet Graph response failed its deployment or shape contract.",
    );
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const block = parsed.data._meta.block;
  const lag = now - block.timestamp;
  if (!Number.isSafeInteger(lag) || lag < 0) {
    return failure(record, "unsupported", "Wallet Graph freshness metadata is invalid.");
  }
  const status =
    lag > M0_CORE_POLICY.freshness.qualityStaleAfterSeconds
      ? ("stale" as const)
      : ("fresh" as const);
  const freshness: ResultFreshness = {
    source_id: record.source_id,
    status,
    indexed_block: block.number,
    indexed_block_timestamp: block.timestamp,
    indexed_block_hash: block.hash?.toLowerCase() ?? null,
    queried_at: now,
    lag_seconds: lag,
  };
  const warnings = [
    ...(parsed.data._meta.hasIndexingErrors === true
      ? ["Wallet Graph source reports indexing errors."]
      : []),
    ...(status === "stale" ? ["Wallet Graph source is stale."] : []),
    ...(parsed.data.positions.length > request.limit
      ? [
          `Wallet Graph positions were truncated to the requested limit of ${String(request.limit)}.`,
        ]
      : []),
  ];
  if (status === "stale") {
    return {
      status: "stale",
      positions: null,
      freshness,
      provenance: provenance(record),
      warnings,
    };
  }

  try {
    return {
      status: "ok",
      positions: parsed.data.positions
        .slice(0, request.limit)
        .map((position) => mapPosition(position, record)),
      freshness,
      provenance: provenance(record),
      warnings,
    };
  } catch {
    return failure(record, "unsupported", "Wallet Graph positions failed canonical normalization.");
  }
}
