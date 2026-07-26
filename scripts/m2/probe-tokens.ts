import { readManifest, politeGap, writeEvidence, writeManifest } from "./lib/evidence.ts";
import { loadGraphApiKey, postGraphQuery } from "./lib/gateway.ts";
import { TOKEN_IDS, tokenIntrospectionQuery, tokenQuery } from "./lib/queries.ts";

interface Candidate {
  readonly slug: string;
  readonly subgraph_id: string;
  readonly verdict: string;
  token_probe?: Record<string, unknown>;
}

function hasGraphErrors(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { errors?: unknown }).errors)
  );
}

const manifest = await readManifest();
const candidates = (manifest.candidates ?? []) as Candidate[];
const apiKey = await loadGraphApiKey();

for (const candidate of candidates.filter(({ verdict }) => verdict === "healthy")) {
  const variables = { ids: TOKEN_IDS };
  const result = await postGraphQuery(candidate.subgraph_id, tokenQuery, variables, { apiKey });
  await writeEvidence(
    candidate.slug,
    "04-tokens.json",
    candidate.subgraph_id,
    tokenQuery,
    variables,
    result,
  );
  candidate.token_probe = {
    query_id: tokenQuery.queryId,
    answered: !hasGraphErrors(result.body) && result.error === null,
  };

  if (hasGraphErrors(result.body)) {
    await politeGap();
    const introspection = await postGraphQuery(
      candidate.subgraph_id,
      tokenIntrospectionQuery,
      {},
      { apiKey },
    );
    await writeEvidence(
      candidate.slug,
      "04a-token-introspection.json",
      candidate.subgraph_id,
      tokenIntrospectionQuery,
      {},
      introspection,
    );
  }
  await politeGap();
}

await writeManifest({
  ...manifest,
  token_probe_finished_at: new Date().toISOString(),
  candidates,
});
