/**
 * Captures live Tier-A compare_pools evidence for the two locked WETH/USDC fee
 * tiers, using the exact query text `src/sources/graph/queries.ts` ships.
 *
 * The unit suite replays these captures instead of calling the network, and
 * asserts the recorded `request.query` still matches the shipped constant, so
 * a query edit that is not re-captured fails loudly.
 *
 * Usage: GRAPH_API_KEY=... node scripts/m3/capture-tier-a-evidence.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evidenceRoot = join(root, "tests/integration/__evidence__/m3");

const apiKey = process.env.GRAPH_API_KEY;
if (apiKey === undefined || apiKey.trim() === "") {
  console.error("capture-tier-a-evidence: GRAPH_API_KEY is unset");
  process.exit(1);
}

const queriesSource = await readFile(join(root, "src/sources/graph/queries.ts"), "utf8");
const queryMatch = /export const TIER_A_METRICS_QUERY = `([\s\S]*?)`;/.exec(queriesSource);
if (queryMatch === null) {
  console.error("capture-tier-a-evidence: could not read TIER_A_METRICS_QUERY");
  process.exit(1);
}
const metaMatch = /^const META = `([\s\S]*?)`;$/m.exec(queriesSource);
if (metaMatch === null) {
  console.error("capture-tier-a-evidence: could not read META");
  process.exit(1);
}
const query = queryMatch[1].replace("${META}", metaMatch[1]);

const records = JSON.parse(await readFile(join(root, "src/registry/records.json"), "utf8"));
const profile = JSON.parse(await readFile(join(root, "src/registry/compare-pools.json"), "utf8"));

for (const binding of profile.sources) {
  const record = records.find((candidate) => candidate.source_id === binding.source_id);
  const startedAt = performance.now();
  const response = await fetch(
    `https://gateway.thegraph.com/api/subgraphs/id/${record.locator.subgraph_id}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { pool: binding.pool_address } }),
    },
  );
  const body = await response.json();
  const latencyMs = Math.round(performance.now() - startedAt);

  const capture = {
    captured_at: new Date().toISOString(),
    gateway_host: record.locator.gateway_host,
    subgraph_id: record.locator.subgraph_id,
    query_id: binding.query_id,
    request: { query, variables: { pool: binding.pool_address } },
    response: body,
    transport: { http_status: response.status, latency_ms: latencyMs, error: null },
  };

  const destination = join(evidenceRoot, binding.source_id, "01-pool-metrics.json");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  console.log(
    `${binding.source_id}: http ${response.status}, deployment ${body?.data?._meta?.deployment}, ` +
      `${body?.data?.liquidityPoolDailySnapshots?.length ?? 0} snapshots`,
  );
}
