import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  RegistryConfigurationError,
  getActiveComparePoolGraphSources,
  getSourceById,
  resetRegistryCache,
} from "./index.js";
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

const graphRecordB = {
  ...graphRecord,
  source_id: "test-graph-b",
  protocol: "Test DEX B",
  deployment_or_view_id: "QmTestDeploymentB",
  locator: { ...graphRecord.locator, subgraph_id: "TestSubgraphB" },
} satisfies SourceRegistryRecord;

const records = [graphRecord, graphRecordB, nuthatchRecord];

const QUERY_ID = "test-pool-metrics-v1";
const SCHEMA_CONTRACT_ID = "test-pool-metrics-shape-v1";

function binding(sourceId: string, poolSuffix: string, priority: number) {
  return {
    source_id: sourceId,
    pool_address: `0x${poolSuffix.repeat(40).slice(0, 40)}`,
    query_id: QUERY_ID,
    schema_contract_id: SCHEMA_CONTRACT_ID,
    priority,
  };
}

const profile = {
  profile_id: "test-compare-pools-v1",
  chain_id: 8453,
  token0: "0x4200000000000000000000000000000000000006",
  token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  window_methodology: "completed-utc-days-v1",
  sources: [binding("test-graph-a", "a", 1), binding("test-graph-b", "b", 2)],
};

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

describe("getActiveComparePoolGraphSources", () => {
  it("joins exactly two bindings to their registry records", () => {
    const sources = getActiveComparePoolGraphSources({ records, profile });

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.source_id)).toEqual(["test-graph-a", "test-graph-b"]);
  });

  it("orders by priority regardless of the order written in the profile", () => {
    const reversed = {
      ...profile,
      sources: [binding("test-graph-b", "b", 2), binding("test-graph-a", "a", 1)],
    };

    const sources = getActiveComparePoolGraphSources({ records, profile: reversed });

    expect(sources.map((source) => source.priority)).toEqual([1, 2]);
    expect(sources.map((source) => source.source_id)).toEqual(["test-graph-a", "test-graph-b"]);
  });

  it("carries the locator and pin the client and deployment check need", () => {
    const [first] = getActiveComparePoolGraphSources({ records, profile });

    expect(first?.record.locator).toEqual({
      kind: "graph_subgraph",
      gateway_host: "gateway.thegraph.com",
      subgraph_id: "TestSubgraphA",
    });
    expect(first?.record.deployment_or_view_id).toBe("QmTestDeploymentA");
    expect(first?.record.source_type).toBe("native_subgraph");
  });

  it("carries the profile-level token pair and window methodology", () => {
    const [first] = getActiveComparePoolGraphSources({ records, profile });

    expect(first?.profile_id).toBe("test-compare-pools-v1");
    expect(first?.token0).toBe("0x4200000000000000000000000000000000000006");
    expect(first?.token1).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(first?.window_methodology).toBe("completed-utc-days-v1");
  });

  it("resolves both bindings to one shared query and response contract", () => {
    const sources = getActiveComparePoolGraphSources({ records, profile });

    expect(new Set(sources.map((source) => source.query_id))).toEqual(new Set([QUERY_ID]));
    expect(new Set(sources.map((source) => source.schema_contract_id))).toEqual(
      new Set([SCHEMA_CONTRACT_ID]),
    );
  });

  it("reads the profile from an injected file URL", () => {
    const location = writeJsonFile("compare-pools.json", JSON.stringify(profile));

    expect(getActiveComparePoolGraphSources({ records, profile: location })).toHaveLength(2);
  });

  it("accepts entity requirements every record covers", () => {
    const sources = getActiveComparePoolGraphSources({
      records,
      profile,
      requiredEntities: ["Pool", "PoolDayData"],
    });

    expect(sources).toHaveLength(2);
  });

  it("returns deeply frozen sources", () => {
    const [first] = getActiveComparePoolGraphSources({ records, profile });

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.record)).toBe(true);
  });
});
describe("record validation", () => {
  it("rejects a missing registry file with the path in the diagnostic", () => {
    const missing = new URL("file:///deeptrace-does-not-exist/records.json");

    expect(() => getSourceById("test-graph-a", { records: missing })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("rejects malformed JSON", () => {
    const location = writeJsonFile("records.json", "{ not json");

    expect(() => getSourceById("test-graph-a", { records: location })).toThrow(
      /records\.json: is not valid JSON/,
    );
  });

  it("rejects a registry that is not an array", () => {
    expect(() => getSourceById("test-graph-a", { records: { sources: [] } })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("rejects an empty registry", () => {
    expect(() => getSourceById("test-graph-a", { records: [] })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("names the failing index and field", () => {
    const invalid = [graphRecord, { ...graphRecord, source_id: "test-graph-b", protocol: "" }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /records\.json\[1\]\.protocol/,
    );
  });

  it("rejects a gateway host outside the allowlist", () => {
    const invalid = [
      { ...graphRecord, locator: { ...graphRecord.locator, gateway_host: "evil.example.com" } },
    ];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /records\.json\[0\]\.locator\.gateway_host/,
    );
  });

  it("rejects a chain other than Base", () => {
    const invalid = [{ ...graphRecord, chain_id: 1 }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /records\.json\[0\]\.chain_id/,
    );
  });

  it("rejects an empty subgraph id", () => {
    const invalid = [{ ...graphRecord, locator: { ...graphRecord.locator, subgraph_id: "" } }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /records\.json\[0\]\.locator\.subgraph_id/,
    );
  });

  it("rejects an empty pinned deployment id", () => {
    const invalid = [{ ...graphRecord, deployment_or_view_id: "" }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /records\.json\[0\]\.deployment_or_view_id/,
    );
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    const invalid = [{ ...graphRecord, gateway_url: "https://gateway.thegraph.com/x" }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("rejects a Graph locator paired with a Nuthatch source type", () => {
    const invalid = [{ ...graphRecord, source_type: "nuthatch_view" }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("rejects duplicate source ids", () => {
    const invalid = [graphRecord, { ...graphRecord, deployment_or_view_id: "QmOther" }];

    expect(() => getSourceById("test-graph-a", { records: invalid })).toThrow(
      /duplicate source_id "test-graph-a"/,
    );
  });

  it("reports every invalid field in one error", () => {
    const invalid = [{ ...graphRecord, protocol: "", supported_entities: [] }];

    try {
      getSourceById("test-graph-a", { records: invalid });
      expect.unreachable("expected a registry configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistryConfigurationError);
      expect((error as RegistryConfigurationError).issues.length).toBeGreaterThan(1);
    }
  });
});

function expectProfileRejected(profileOverride: unknown, pattern: RegExp): void {
  expect(() => getActiveComparePoolGraphSources({ records, profile: profileOverride })).toThrow(
    pattern,
  );
}

describe("compare-pools profile validation", () => {
  it("rejects a missing profile file", () => {
    const missing = new URL("file:///deeptrace-does-not-exist/compare-pools.json");

    expect(() => getActiveComparePoolGraphSources({ records, profile: missing })).toThrow(
      RegistryConfigurationError,
    );
  });

  it("rejects malformed profile JSON", () => {
    const location = writeJsonFile("compare-pools.json", "{ not json");

    expectProfileRejected(location, /compare-pools\.json: is not valid JSON/);
  });

  it("rejects fewer than two bindings", () => {
    expectProfileRejected(
      { ...profile, sources: profile.sources.slice(0, 1) },
      /compare-pools\.json\.sources/,
    );
  });

  it("rejects more than two bindings", () => {
    expectProfileRejected(
      { ...profile, sources: [...profile.sources, binding("test-graph-a", "d", 3)] },
      /compare-pools\.json\.sources/,
    );
  });

  it("rejects a duplicate source binding", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [binding("test-graph-a", "a", 1), binding("test-graph-a", "b", 2)],
      },
      /sources\[1\]\.source_id: "test-graph-a" duplicates sources\[0\]/,
    );
  });

  it("rejects a duplicate pool address", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [binding("test-graph-a", "a", 1), binding("test-graph-b", "a", 2)],
      },
      /sources\[1\]\.pool_address: .* duplicates sources\[0\]/,
    );
  });

  it("rejects a duplicate priority, which would make output order unstable", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [binding("test-graph-a", "a", 1), binding("test-graph-b", "b", 1)],
      },
      /sources\[1\]\.priority: "1" duplicates sources\[0\]/,
    );
  });

  it("rejects a binding that names an unknown source", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [binding("test-graph-a", "a", 1), binding("absent-source", "c", 2)],
      },
      /sources\[1\]\.source_id: "absent-source" is not present in records\.json/,
    );
  });

  it("rejects a binding to an inactive record", () => {
    const withInactive = [{ ...graphRecordB, status: "inactive" }, graphRecord];

    expect(() => getActiveComparePoolGraphSources({ records: withInactive, profile })).toThrow(
      /sources\[1\]\.source_id: "test-graph-b" is inactive/,
    );
  });

  it("rejects a binding to a non-Graph record", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [binding("test-graph-a", "a", 1), binding("test-nuthatch", "c", 2)],
      },
      /sources\[1\]\.source_id: "test-nuthatch" is not a Graph source/,
    );
  });

  it("rejects bindings that do not share one query template", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [
          binding("test-graph-a", "a", 1),
          { ...binding("test-graph-b", "b", 2), query_id: "other-query-v1" },
        ],
      },
      /sources\[1\]\.query_id: query_id "other-query-v1" does not match sources\[0\]/,
    );
  });

  it("rejects bindings that do not share one response contract", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [
          binding("test-graph-a", "a", 1),
          { ...binding("test-graph-b", "b", 2), schema_contract_id: "other-shape-v1" },
        ],
      },
      /sources\[1\]\.schema_contract_id: schema_contract_id "other-shape-v1"/,
    );
  });

  it("rejects a mixed schema tier across the selected set", () => {
    const mixedTier = [graphRecord, { ...graphRecordB, source_type: "standardized_subgraph" }];

    expect(() => getActiveComparePoolGraphSources({ records: mixedTier, profile })).toThrow(
      /source_type "standardized_subgraph" does not match sources\[0\] "native_subgraph"/,
    );
  });

  it("rejects a checksummed pool address", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [
          {
            ...binding("test-graph-a", "a", 1),
            pool_address: "0x6C561B446416E1A00E8E93E221854D6EA4171372",
          },
          binding("test-graph-b", "b", 2),
        ],
      },
      /sources\[0\]\.pool_address/,
    );
  });

  it("rejects a truncated pool address", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [
          { ...binding("test-graph-a", "a", 1), pool_address: "0xabc" },
          binding("test-graph-b", "b", 2),
        ],
      },
      /sources\[0\]\.pool_address/,
    );
  });

  it("rejects a token pair that names the same token twice", () => {
    expectProfileRejected(
      { ...profile, token1: profile.token0 },
      /compare-pools\.json\.token1: must differ from token0/,
    );
  });

  it("rejects a chain other than Base", () => {
    expectProfileRejected({ ...profile, chain_id: 1 }, /compare-pools\.json\.chain_id/);
  });

  it("rejects a non-positive priority", () => {
    expectProfileRejected(
      {
        ...profile,
        sources: [
          { ...binding("test-graph-a", "a", 1), priority: 0 },
          binding("test-graph-b", "b", 2),
        ],
      },
      /sources\[0\]\.priority/,
    );
  });

  it("rejects unknown profile keys", () => {
    expectProfileRejected(
      { ...profile, gateway_url: "https://example.com" },
      /compare-pools\.json/,
    );
  });

  it("rejects a record that does not support every entity the query needs", () => {
    const withoutDayData = [
      graphRecord,
      { ...graphRecordB, supported_entities: ["Pool", "Token"] },
    ];

    expect(() =>
      getActiveComparePoolGraphSources({
        records: withoutDayData,
        profile,
        requiredEntities: ["Pool", "PoolDayData"],
      }),
    ).toThrow(/sources\[1\]\.source_id: "test-graph-b" does not support PoolDayData/);
  });

  it("reports every profile problem in one error", () => {
    try {
      getActiveComparePoolGraphSources({
        records,
        profile: {
          ...profile,
          token1: profile.token0,
          sources: [binding("test-graph-a", "a", 1), binding("test-graph-a", "b", 1)],
        },
      });
      expect.unreachable("expected a registry configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistryConfigurationError);
      expect((error as RegistryConfigurationError).issues.length).toBeGreaterThan(2);
    }
  });
});

describe("shipped registry and profile", () => {
  // Exercises the default-path load (no injection) against the committed M2
  // artifacts so a deploy-time regression in records.json or compare-pools.json
  // is caught here rather than in the adapter.
  it("loads the two locked M2 Graph bindings in priority order", () => {
    const sources = getActiveComparePoolGraphSources();

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.source_id)).toEqual([
      "uniswap-v3-base-native",
      "exchange-v3-base",
    ]);
    expect(sources.map((source) => source.priority)).toEqual([1, 2]);
  });

  it("pins the locked WETH/USDC pair and Base chain", () => {
    const [first] = getActiveComparePoolGraphSources();

    expect(first?.chain_id ?? first?.record.chain_id).toBe(8453);
    expect(first?.token0).toBe("0x4200000000000000000000000000000000000006");
    expect(first?.token1).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  });

  it("binds each profile pool to its registry deployment pin", () => {
    const sources = getActiveComparePoolGraphSources();

    for (const source of sources) {
      expect(source.record.deployment_or_view_id).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
      expect(source.pool_address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(source.record.locator.kind).toBe("graph_subgraph");
    }
  });

  it("shares one query and schema contract across both bindings", () => {
    const sources = getActiveComparePoolGraphSources();
    const queryIds = new Set(sources.map((source) => source.query_id));
    const schemaContractIds = new Set(sources.map((source) => source.schema_contract_id));

    expect(queryIds.size).toBe(1);
    expect(schemaContractIds.size).toBe(1);
    expect([...queryIds][0]).toBe("graph-pool-metrics-tier-b-v1");
  });
});
