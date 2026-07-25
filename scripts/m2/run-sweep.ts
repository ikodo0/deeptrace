import { readFile } from "node:fs/promises";

import { politeGap, writeEvidence, writeManifest } from "./lib/evidence.ts";
import { loadGraphApiKey, postGraphQuery } from "./lib/gateway.ts";
import { metaQuery, tierAMarkerQuery, tierBLineageQuery, tierBMarkerQuery } from "./lib/queries.ts";

interface Candidate {
  readonly slug: string;
  readonly protocol_name: string;
  readonly subgraph_id: string;
  readonly explorer_url: string;
  readonly publisher: string;
}

interface Meta {
  readonly block?: {
    readonly number?: number;
    readonly timestamp?: number;
    readonly hash?: string;
  };
  readonly hasIndexingErrors?: boolean;
  readonly deployment?: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function dataFrom(body: unknown): Record<string, unknown> | null {
  return object(object(body)?.data);
}

function metaFrom(body: unknown): Meta | null {
  return object(dataFrom(body)?._meta);
}

function markerAnswered(body: unknown, field: string): boolean {
  const data = dataFrom(body);
  return data !== null && Object.hasOwn(data, field);
}

const candidates = JSON.parse(
  await readFile(new URL("./candidates.json", import.meta.url), "utf8"),
) as Candidate[];
const apiKey = await loadGraphApiKey();
const sweptAt = new Date().toISOString();
const results: Array<Record<string, unknown>> = [];

for (const candidate of candidates) {
  const metaResult = await postGraphQuery(candidate.subgraph_id, metaQuery, {}, { apiKey });
  await writeEvidence(
    candidate.slug,
    "01-meta.json",
    candidate.subgraph_id,
    metaQuery,
    {},
    metaResult,
  );
  await politeGap();

  const tierAResult = await postGraphQuery(candidate.subgraph_id, tierAMarkerQuery, {}, { apiKey });
  await writeEvidence(
    candidate.slug,
    "02-tier-a-marker.json",
    candidate.subgraph_id,
    tierAMarkerQuery,
    {},
    tierAResult,
  );
  await politeGap();

  const tierBResult = await postGraphQuery(candidate.subgraph_id, tierBMarkerQuery, {}, { apiKey });
  await writeEvidence(
    candidate.slug,
    "03-tier-b-marker.json",
    candidate.subgraph_id,
    tierBMarkerQuery,
    {},
    tierBResult,
  );

  const tierA = markerAnswered(tierAResult.body, "dexAmmProtocols");
  const tierB = markerAnswered(tierBResult.body, "factories");
  let tier: "A" | "B" | "unknown" | "collision" = "unknown";
  if (tierA && tierB) tier = "collision";
  else if (tierA) tier = "A";
  else if (tierB) tier = "B";

  if (tier === "B") {
    await politeGap();
    const lineage = await postGraphQuery(candidate.subgraph_id, tierBLineageQuery, {}, { apiKey });
    await writeEvidence(
      candidate.slug,
      "03a-tier-b-lineage.json",
      candidate.subgraph_id,
      tierBLineageQuery,
      {},
      lineage,
    );
  }

  results.push({
    ...candidate,
    deployment_id: metaFrom(metaResult.body)?.deployment ?? null,
    indexed_block: metaFrom(metaResult.body)?.block?.number ?? null,
    indexed_block_timestamp: metaFrom(metaResult.body)?.block?.timestamp ?? null,
    has_indexing_errors: metaFrom(metaResult.body)?.hasIndexingErrors ?? null,
    tier,
  });
  await politeGap();
}

const referenceBlock = Math.max(
  ...results
    .map((candidate) => candidate.indexed_block)
    .filter((block): block is number => typeof block === "number"),
);
const capturedAtSeconds = Math.floor(Date.now() / 1000);

for (const candidate of results) {
  const block = candidate.indexed_block;
  const timestamp = candidate.indexed_block_timestamp;
  const hasErrors = candidate.has_indexing_errors === true;
  let verdict: "healthy" | "suspect" | "reject" = "reject";
  let reason = "missing usable _meta";

  if (typeof block === "number" && typeof timestamp === "number") {
    const blockLag = referenceBlock - block;
    const ageSeconds = capturedAtSeconds - timestamp;
    if (hasErrors || blockLag > 5_000 || ageSeconds > 3_600) {
      verdict = "reject";
      reason = hasErrors
        ? "hasIndexingErrors is true"
        : `lag=${blockLag} blocks, age=${ageSeconds}s`;
    } else if (blockLag > 500 || ageSeconds > 900) {
      verdict = "suspect";
      reason = `lag=${blockLag} blocks, age=${ageSeconds}s`;
    } else {
      verdict = "healthy";
      reason = `lag=${blockLag} blocks, age=${ageSeconds}s`;
    }
  }

  candidate.verdict = verdict;
  candidate.verdict_reason = reason;
}

await writeManifest({
  sweep_started_at: sweptAt,
  sweep_finished_at: new Date().toISOString(),
  reference_block: Number.isFinite(referenceBlock) ? referenceBlock : null,
  candidates: results,
  final_selections: [],
});
