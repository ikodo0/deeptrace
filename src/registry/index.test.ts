import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { getSourceById, resetRegistryCache } from "./index.js";
import type { SourceRegistryRecord } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetRegistryCache();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeJsonFile(name: string, contents: string): URL {
  const directory = mkdtempSync(join(tmpdir(), "deeptrace-registry-"));
  temporaryDirectories.push(directory);
  const file = join(directory, name);
  writeFileSync(file, contents, "utf8");
  return pathToFileURL(file);
}

const graphRecord = {
  source_id: "test-graph-a",
  category: "dex",
  protocol: "Test DEX A",
  chain_id: 8453,
  source_type: "native_subgraph",
  deployment_or_view_id: "QmTestDeploymentA",
  schema_version: null,
  methodology_version: null,
  supported_entities: ["Pool", "PoolDayData", "Token"],
  status: "active",
  locator: {
    kind: "graph_subgraph",
    gateway_host: "gateway.thegraph.com",
    subgraph_id: "TestSubgraphA",
  },
} satisfies SourceRegistryRecord;

const nuthatchRecord = {
  source_id: "test-nuthatch",
  category: "dex",
  protocol: "Test DEX A",
  chain_id: 8453,
  source_type: "nuthatch_view",
  deployment_or_view_id: "test-view-hash",
  schema_version: "1.0.0",
  methodology_version: "1.0.0",
  supported_entities: ["Swap"],
  status: "active",
  locator: {
    kind: "nuthatch_view",
    base_url_env: "NUTHATCH_BASE_URL",
    view_id: "pool-swaps",
  },
} satisfies SourceRegistryRecord;

describe("getSourceById", () => {
  it("returns a Graph record parsed from an injected value", () => {
    const record = getSourceById("test-graph-a", { records: [graphRecord, nuthatchRecord] });

    expect(record).toEqual(graphRecord);
  });

  it("returns a Nuthatch record, which is not Graph-specific", () => {
    const record = getSourceById("test-nuthatch", { records: [graphRecord, nuthatchRecord] });

    expect(record?.source_type).toBe("nuthatch_view");
  });

  it("returns an inactive record so callers can report why it is unusable", () => {
    const inactive = { ...graphRecord, status: "inactive" } satisfies SourceRegistryRecord;

    expect(getSourceById("test-graph-a", { records: [inactive] })?.status).toBe("inactive");
  });

  it("returns undefined for an unknown source id", () => {
    expect(getSourceById("absent", { records: [graphRecord] })).toBeUndefined();
  });

  it("reads records from an injected file URL", () => {
    const location = writeJsonFile("records.json", JSON.stringify([graphRecord]));

    expect(getSourceById("test-graph-a", { records: location })).toEqual(graphRecord);
  });

  it("returns a deeply frozen record", () => {
    const record = getSourceById("test-graph-a", { records: [graphRecord] });

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record?.locator)).toBe(true);
    expect(Object.isFrozen(record?.supported_entities)).toBe(true);
  });
});
