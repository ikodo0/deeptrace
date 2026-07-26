import { describe, expect, it } from "vitest";

import {
  COMPARE_LENDING_SOURCE_COUNT,
  getActiveCompareLendingGraphSources,
} from "../../src/registry/index.js";
import { M0_CORE_POLICY } from "../../src/policy/index.js";
import { M0_COMPARE_LENDING_SCOPE } from "../../src/scope/index.js";
import { TIER_A_LENDING_METRICS_QUERY_ID } from "../../src/sources/graph/index.js";

describe("shipped compare-lending registry configuration", () => {
  const sources = getActiveCompareLendingGraphSources();

  it("loads exactly three lending bindings in priority order", () => {
    expect(sources).toHaveLength(COMPARE_LENDING_SOURCE_COUNT);
    expect(sources.map((source) => source.priority)).toEqual([1, 2, 3]);
    expect(sources.map((source) => source.source_id)).toEqual([
      "messari-aave-v3-base",
      "messari-seamless-base",
      "messari-moonwell-base",
    ]);
    expect(sources.map((source) => source.record.protocol)).toEqual([
      "aave-v3",
      "seamless-protocol",
      "moonwell",
    ]);
  });

  it("serves every binding with one query id, contract, and source type", () => {
    for (const source of sources) {
      expect(source.query_id).toBe(TIER_A_LENDING_METRICS_QUERY_ID);
      expect(source.schema_contract_id).toBe(TIER_A_LENDING_METRICS_QUERY_ID);
      expect(source.record.source_type).toBe("standardized_subgraph");
      expect(source.record.category).toBe("lending");
      expect(source.record.status).toBe("active");
      expect(source.market_token).toBe(M0_CORE_POLICY.lending.marketToken);
    }
  });

  it("pins the probed deployments and subgraph ids", () => {
    expect(
      sources.map((source) => [source.record.deployment_or_view_id, source.record.locator]),
    ).toEqual([
      [
        "Qmb5j4tE5deSXCrubQeqeghfrGhyfQBiq9DuZNMfHBjbfL",
        {
          kind: "graph_subgraph",
          gateway_host: "gateway.thegraph.com",
          subgraph_id: "D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9",
        },
      ],
      [
        "QmPSmTkJPSKLFn46YdgwMKV5K2c9a3pkWnzDCC4ccCLAXE",
        {
          kind: "graph_subgraph",
          gateway_host: "gateway.thegraph.com",
          subgraph_id: "2u4mWUV4xS19ef1MbnxZHWLLMwdPxtVifH46JbonXwXP",
        },
      ],
      [
        "QmeE6TgfRmK2iLAgCLBeXuxJQ2VXLFAeHVMTvmnECiFw7y",
        {
          kind: "graph_subgraph",
          gateway_host: "gateway.thegraph.com",
          subgraph_id: "33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg",
        },
      ],
    ]);
  });

  it("keeps the locked scope allowlist aligned with the shipped profile", () => {
    // Settlement orders freshness, provenance, and warnings from the scope, so
    // a scope that drifts from the profile would silently misattribute them.
    expect(
      M0_COMPARE_LENDING_SCOPE.sources.map((source) => ({
        source_id: source.source_id,
        protocol: source.protocol,
        deployment_or_view_id: source.deployment_or_view_id,
        query_id: source.query_id,
      })),
    ).toEqual(
      sources.map((source) => ({
        source_id: source.source_id,
        protocol: source.record.protocol,
        deployment_or_view_id: source.record.deployment_or_view_id,
        query_id: source.query_id,
      })),
    );
    expect(M0_COMPARE_LENDING_SCOPE.marketToken.address).toBe(M0_CORE_POLICY.lending.marketToken);
  });
});
