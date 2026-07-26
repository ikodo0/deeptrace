import { z } from "zod";

import { M0_CORE_POLICY } from "../policy/index.js";
import {
  researchWalletResponseSchema,
  type DeFiPosition,
  type ResearchWalletRequestInput,
  type ResearchWalletResponse,
  type WalletActivity,
  type WalletResearchData,
} from "../schemas/index.js";
import {
  WALLET_RESEARCH_SCOPE,
  WALLET_RESEARCH_SECTIONS,
  type WalletResearchSection,
} from "../scope/wallet-research.js";

import {
  inspectWalletResearchQuery,
  paginateWalletActivity,
  WalletResearchQueryError,
} from "./wallet-query.js";
import type {
  WalletActivityResult,
  WalletGraphResult,
  WalletResearchSourceGateway,
} from "./wallet-sources.js";

export { WalletResearchQueryError };

export class ResearchWalletToolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchWalletToolError";
  }
}

function baseUnits(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, "0");
  if (decimals === 0) {
    return digits;
  }
  const whole = digits.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function observedAssets(activities: readonly WalletActivity[], positions: readonly DeFiPosition[]) {
  const byAddress = new Map<
    string,
    { token_address: string; symbol: string; decimals: number; source_ids: Set<string> }
  >();
  for (const activity of activities) {
    for (const asset of activity.assets) {
      const entry = byAddress.get(asset.token_address) ?? {
        token_address: asset.token_address,
        symbol: asset.symbol,
        decimals: asset.decimals,
        source_ids: new Set<string>(),
      };
      entry.source_ids.add(activity.source_id);
      byAddress.set(asset.token_address, entry);
    }
  }
  for (const position of positions) {
    for (const asset of position.assets) {
      const entry = byAddress.get(asset.token_address) ?? {
        token_address: asset.token_address,
        symbol: asset.symbol,
        decimals: asset.decimals,
        source_ids: new Set<string>(),
      };
      position.source_ids.forEach((sourceId) => entry.source_ids.add(sourceId));
      byAddress.set(asset.token_address, entry);
    }
  }
  return [...byAddress.values()]
    .sort((left, right) => left.token_address.localeCompare(right.token_address))
    .map((entry) => ({ ...entry, source_ids: [...entry.source_ids].sort() }));
}

function counterparties(activities: readonly WalletActivity[]) {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    if (activity.counterparty !== null) {
      counts.set(activity.counterparty, (counts.get(activity.counterparty) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, interaction_count]) => ({
      address,
      interaction_count,
      source_ids: [WALLET_RESEARCH_SCOPE.nuthatch.sourceId],
    }));
}

function observableFlows(activities: readonly WalletActivity[]) {
  const totals = new Map<
    string,
    {
      direction: "inflow" | "outflow";
      token_address: string;
      symbol: string;
      decimals: number;
      raw: bigint;
    }
  >();
  for (const activity of activities) {
    const direction = activity.activity_type === "swap_received" ? "inflow" : "outflow";
    const role = direction === "inflow" ? "swap_out" : "swap_in";
    const asset = activity.assets.find((candidate) => candidate.role === role);
    if (asset === undefined) {
      continue;
    }
    const key = `${direction}:${asset.token_address}`;
    const entry = totals.get(key) ?? {
      direction,
      token_address: asset.token_address,
      symbol: asset.symbol,
      decimals: asset.decimals,
      raw: 0n,
    };
    entry.raw += BigInt(asset.raw_amount);
    totals.set(key, entry);
  }
  return [...totals.values()]
    .sort((left, right) =>
      `${left.direction}:${left.token_address}`.localeCompare(
        `${right.direction}:${right.token_address}`,
      ),
    )
    .map((entry) => ({
      direction: entry.direction,
      token_address: entry.token_address,
      symbol: entry.symbol,
      raw_amount: entry.raw.toString(),
      normalized_amount: baseUnits(entry.raw, entry.decimals),
      source_ids: [WALLET_RESEARCH_SCOPE.nuthatch.sourceId],
    }));
}

function protocolUsage(activities: readonly WalletActivity[], positions: readonly DeFiPosition[]) {
  const protocols = new Map<
    string,
    { activity_count: number; position_count: number; source_ids: Set<string> }
  >();
  for (const activity of activities) {
    const entry = protocols.get(activity.protocol) ?? {
      activity_count: 0,
      position_count: 0,
      source_ids: new Set<string>(),
    };
    entry.activity_count += 1;
    entry.source_ids.add(activity.source_id);
    protocols.set(activity.protocol, entry);
  }
  for (const position of positions) {
    const entry = protocols.get(position.protocol) ?? {
      activity_count: 0,
      position_count: 0,
      source_ids: new Set<string>(),
    };
    entry.position_count += 1;
    position.source_ids.forEach((sourceId) => entry.source_ids.add(sourceId));
    protocols.set(position.protocol, entry);
  }
  return [...protocols]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([protocol, entry]) => ({
      protocol,
      activity_count: entry.activity_count,
      position_count: entry.position_count,
      source_ids: [...entry.source_ids].sort(),
    }));
}

function sourcesForSection(section: WalletResearchSection): readonly ("graph" | "nuthatch")[] {
  if (section === "positions") {
    return ["graph"];
  }
  if (section === "activity" || section === "counterparties" || section === "observable_flows") {
    return ["nuthatch"];
  }
  return ["graph", "nuthatch"];
}

function coverageSections(
  requested: readonly WalletResearchSection[],
  graph: WalletGraphResult,
  nuthatch: WalletActivityResult,
) {
  return WALLET_RESEARCH_SECTIONS.map((section) => {
    const isRequested = requested.includes(section);
    const required = sourcesForSection(section);
    const successes = required.filter((source) =>
      source === "graph" ? graph.status === "ok" : nuthatch.status === "ok",
    );
    return {
      section,
      requested: isRequested,
      status: !isRequested
        ? ("not_requested" as const)
        : successes.length === required.length
          ? ("complete" as const)
          : successes.length > 0
            ? ("partial" as const)
            : ("unavailable" as const),
      source_ids: isRequested
        ? successes.map((source) =>
            source === "graph"
              ? WALLET_RESEARCH_SCOPE.graph.sourceId
              : WALLET_RESEARCH_SCOPE.nuthatch.sourceId,
          )
        : [],
    };
  });
}

function requested<T>(
  sections: readonly WalletResearchSection[],
  section: WalletResearchSection,
  value: T[],
): T[] {
  return sections.includes(section) ? value : [];
}

function assertSize(response: ResearchWalletResponse): ResearchWalletResponse {
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") >
    M0_CORE_POLICY.gateway.maximumResponseBytes
  ) {
    throw new ResearchWalletToolError(
      "research_wallet response exceeded the maximum response size.",
    );
  }
  return response;
}

export async function executeResearchWallet(
  input: ResearchWalletRequestInput,
  sources: WalletResearchSourceGateway,
): Promise<ResearchWalletResponse> {
  const context = inspectWalletResearchQuery(input);
  const [graph, nuthatch] = await Promise.all([
    sources.fetchPositions(context.request),
    sources.fetchActivity(context),
  ]);
  const successfulSources = Number(graph.status === "ok") + Number(nuthatch.status === "ok");
  const graphPositions = graph.status === "ok" ? [...graph.positions] : [];
  const allActivities = nuthatch.status === "ok" ? [...nuthatch.activities] : [];
  const page =
    nuthatch.status === "ok"
      ? paginateWalletActivity(context, allActivities, nuthatch.indexedHead)
      : {
          activities: [] as WalletActivity[],
          pagination: {
            limit: context.request.limit,
            returned: 0,
            has_more: false,
            next_cursor: null,
          },
        };
  const warnings = [
    ...graph.warnings,
    ...nuthatch.warnings,
    ...(graph.status === "ok" && graphPositions.length === 0
      ? ["The selected Graph source returned no supported open positions for this wallet."]
      : []),
    ...(nuthatch.status === "ok" && allActivities.length === 0
      ? ["The indexed Nuthatch pool returned no wallet activity in the requested window."]
      : []),
  ];
  const coverage = {
    requested_sources: 2 as const,
    successful_sources: successfulSources,
    sections: coverageSections(context.request.sections, graph, nuthatch),
  };
  const quality = {
    coverage,
    freshness: [graph.freshness, nuthatch.freshness],
    provenance: [graph.provenance, nuthatch.provenance],
    warnings,
    pagination: context.request.sections.includes("activity")
      ? page.pagination
      : {
          limit: context.request.limit,
          returned: 0,
          has_more: false,
          next_cursor: null,
        },
  };

  if (successfulSources === 0) {
    return assertSize(
      researchWalletResponseSchema.parse({
        status: "failed",
        data: null,
        ...quality,
      }),
    );
  }

  const data: WalletResearchData = {
    chain_id: WALLET_RESEARCH_SCOPE.chainId,
    wallet_address: context.request.address,
    window: context.request.window,
    requested_sections: context.request.sections,
    activity: requested(context.request.sections, "activity", page.activities),
    counterparties: requested(
      context.request.sections,
      "counterparties",
      counterparties(allActivities),
    ),
    protocol_usage: requested(
      context.request.sections,
      "protocol_usage",
      protocolUsage(allActivities, graphPositions),
    ),
    observable_flows: requested(
      context.request.sections,
      "observable_flows",
      observableFlows(allActivities),
    ),
    observed_assets: requested(
      context.request.sections,
      "observed_assets",
      observedAssets(allActivities, graphPositions),
    ),
    positions: requested(context.request.sections, "positions", graphPositions),
  };
  const hasGraphFact = graphPositions.length > 0;
  const hasNuthatchFact = allActivities.length > 0;
  const status =
    successfulSources === 2 && hasGraphFact && hasNuthatchFact ? "complete" : "partial";
  try {
    return assertSize(
      researchWalletResponseSchema.parse({
        status,
        data,
        ...quality,
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ResearchWalletToolError("research_wallet response failed schema validation.", {
        cause: error,
      });
    }
    throw error;
  }
}
