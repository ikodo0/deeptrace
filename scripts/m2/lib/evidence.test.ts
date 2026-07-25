import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeEvidence, type EvidenceDocument } from "./evidence.ts";
import { metaQuery } from "./queries.ts";

void test("writes a well-formed credential-free evidence envelope", async () => {
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
  assert.equal(evidence.gateway_host, "gateway.thegraph.com");
  assert.equal(evidence.subgraph_id, "dummy-id");
  assert.equal(evidence.query_id, "m2-meta-v1");
  assert.deepEqual(evidence.response, {
    data: { _meta: { deployment: "QmDummy" } },
  });
  assert.equal(Object.hasOwn(evidence, "headers"), false);
});
