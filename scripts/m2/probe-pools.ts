import { politeGap, readManifest, writeEvidence, writeManifest } from "./lib/evidence.ts";
import { loadGraphApiKey, postGraphQuery } from "./lib/gateway.ts";
import { poolProbeFailureMessage } from "./lib/pool-probe.ts";
import {
  tierAMetricsQuery,
  tierAPoolsQuery,
  tierASnapshotsQuery,
  tierASnapshotIntrospectionQuery,
  tierBMetricsQuery,
  tierBPoolsQuery,
  tierBSnapshotsQuery,
} from "./lib/queries.ts";

const WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

interface Selection {
  readonly slug: string;
  readonly subgraph_id: string;
  readonly tier: "A" | "B";
  pool_address?: string;
  pool_probe_error?: string;
}

interface Candidate {
  readonly slug: string;
  readonly subgraph_id: string;
  readonly tier: "A" | "B" | "unknown" | "collision";
  readonly verdict: string;
  readonly token_probe?: { readonly answered?: boolean };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function firstPoolId(body: unknown, field: string): string | null {
  const data = object(object(body)?.data);
  const pools = data?.[field];
  if (!Array.isArray(pools)) return null;
  const first = object(pools[0]);
  return typeof first?.id === "string" ? first.id : null;
}

const manifest = await readManifest();
const finalSelections = (manifest.final_selections ?? []) as Selection[];
const candidates = (manifest.candidates ?? []) as Candidate[];
const selectedTier =
  finalSelections[0]?.tier ??
  (candidates.filter(
    ({ verdict, tier, token_probe: tokenProbe }) =>
      verdict === "healthy" && tier === "A" && tokenProbe?.answered,
  ).length >= 3
    ? "A"
    : "B");
const selections: Selection[] =
  finalSelections.length > 0
    ? finalSelections
    : candidates
        .filter(
          ({ verdict, tier, token_probe: tokenProbe }) =>
            verdict === "healthy" && tier === selectedTier && tokenProbe?.answered,
        )
        .map(({ slug, subgraph_id: subgraphId, tier }): Selection => ({
          slug,
          subgraph_id: subgraphId,
          tier: tier as "A" | "B",
        }));
if (selections.length < 3) {
  throw new Error("Fewer than three healthy, token-compatible candidates exist in one tier.");
}
if (new Set(selections.map(({ tier }) => tier)).size !== 1) {
  throw new Error("Final selections mix schema tiers.");
}

const pair = object(manifest.token_pair);
const quoteToken = typeof pair?.quote_token === "string" ? pair.quote_token : NATIVE_USDC;
const apiKey = await loadGraphApiKey();

for (const selection of selections) {
  const poolsTemplate = selection.tier === "A" ? tierAPoolsQuery : tierBPoolsQuery;
  const poolVariables =
    selection.tier === "A" ? { tokens: [WETH, quoteToken] } : { token0: WETH, token1: quoteToken };
  const pools = await postGraphQuery(selection.subgraph_id, poolsTemplate, poolVariables, {
    apiKey,
  });
  await writeEvidence(
    selection.slug,
    "05-pools.json",
    selection.subgraph_id,
    poolsTemplate,
    poolVariables,
    pools,
  );

  let pool = selection.pool_address;
  if (!pool) {
    pool =
      firstPoolId(pools.body, selection.tier === "A" ? "liquidityPools" : "pools") ?? undefined;
  }
  if (!pool) {
    selection.pool_probe_error = poolProbeFailureMessage(pools.error);
    await politeGap();
    continue;
  }
  selection.pool_address = pool;
  await politeGap();

  if (selection.tier === "A") {
    const introspection = await postGraphQuery(
      selection.subgraph_id,
      tierASnapshotIntrospectionQuery,
      {},
      { apiKey },
    );
    await writeEvidence(
      selection.slug,
      "05a-tier-a-snapshot-schema.json",
      selection.subgraph_id,
      tierASnapshotIntrospectionQuery,
      {},
      introspection,
    );
    await politeGap();
  }

  const snapshotsTemplate = selection.tier === "A" ? tierASnapshotsQuery : tierBSnapshotsQuery;
  const snapshotVariables = { pool };
  const snapshots = await postGraphQuery(
    selection.subgraph_id,
    snapshotsTemplate,
    snapshotVariables,
    { apiKey },
  );
  await writeEvidence(
    selection.slug,
    "06-snapshots.json",
    selection.subgraph_id,
    snapshotsTemplate,
    snapshotVariables,
    snapshots,
  );
  await politeGap();

  const metricsTemplate = selection.tier === "A" ? tierAMetricsQuery : tierBMetricsQuery;
  const metrics = await postGraphQuery(
    selection.subgraph_id,
    metricsTemplate,
    { pool },
    { apiKey },
  );
  await writeEvidence(
    selection.slug,
    "07-common-metrics.json",
    selection.subgraph_id,
    metricsTemplate,
    { pool },
    metrics,
  );
  await politeGap();
}

await writeManifest({
  ...manifest,
  pool_probe_finished_at: new Date().toISOString(),
  pool_candidates: selections,
});
