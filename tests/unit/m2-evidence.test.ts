import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { writeEvidence, type EvidenceDocument } from "../../scripts/m2/lib/evidence.ts";
import { metaQuery, tierBMetricsQuery } from "../../scripts/m2/lib/queries.ts";

const evidenceRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/__evidence__/m2",
);

describe("writeEvidence", () => {
  it("writes a well-formed credential-free evidence envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deeptrace-m2-"));
    await writeEvidence(
      "dummy",
      "01-meta.json",
      "dummy-id",
      metaQuery,
      {},
      {
        status: 200,
        body: { data: { _meta: { deployment: "QmDummy" } } },
        error: null,
        latencyMs: 3,
      },
      root,
    );

    const contents = await readFile(path.join(root, "dummy", "01-meta.json"), "utf8");
    const evidence = JSON.parse(contents) as EvidenceDocument;
    expect(evidence.gateway_host).toBe("gateway.thegraph.com");
    expect(evidence.subgraph_id).toBe("dummy-id");
    expect(evidence.query_id).toBe("m2-meta-v1");
    expect(evidence.response).toEqual({
      data: { _meta: { deployment: "QmDummy" } },
    });
    expect(Object.hasOwn(evidence, "headers")).toBe(false);
  });

  it("keeps the historical M2 metrics query and captured evidence on v1", async () => {
    expect(tierBMetricsQuery.queryId).toBe("m2-tier-b-metrics-v1");

    for (const sourceId of ["uniswap-v3-base-native", "exchange-v3-base"]) {
      const contents = await readFile(
        path.join(evidenceRoot, sourceId, "07-common-metrics.json"),
        "utf8",
      );
      const evidence = JSON.parse(contents) as EvidenceDocument;
      expect(evidence.query_id).toBe("m2-tier-b-metrics-v1");
    }
  });
});
