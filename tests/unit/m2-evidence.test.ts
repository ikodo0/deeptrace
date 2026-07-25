import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeEvidence, type EvidenceDocument } from "../../scripts/m2/lib/evidence.ts";
import { metaQuery } from "../../scripts/m2/lib/queries.ts";

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
});
