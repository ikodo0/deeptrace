import { describe, expect, it } from "vitest";

import { M0_CORE_POLICY } from "../../src/policy/index.js";
import { getActiveComparePoolGraphSources } from "../../src/registry/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";

describe("M0 compare_pools live scope", () => {
  it("mirrors the active registry Graph bindings", () => {
    const sources = getActiveComparePoolGraphSources();
    expect(sources).toHaveLength(M0_COMPARE_POOLS_SCOPE.graphSources.length);
    expect(M0_COMPARE_POOLS_SCOPE.graphSources.length).toBe(
      M0_CORE_POLICY.coverage.expectedGraphResults,
    );

    for (const [index, scoped] of M0_COMPARE_POOLS_SCOPE.graphSources.entries()) {
      const bound = sources[index];
      expect(bound).toBeDefined();
      expect(bound!.source_id).toBe(scoped.source_id);
      expect(bound!.pool_address).toBe(scoped.pool_address);
      expect(bound!.query_id).toBe(scoped.query_id);
      expect(bound!.record.protocol).toBe(scoped.protocol);
      expect(bound!.record.deployment_or_view_id).toBe(scoped.deployment_or_view_id);
      expect(bound!.token0).toBe(M0_COMPARE_POOLS_SCOPE.token0.address);
      expect(bound!.token1).toBe(M0_COMPARE_POOLS_SCOPE.token1.address);
    }
  });

  it("reserves Nuthatch without claiming a verified registry record", () => {
    expect(M0_COMPARE_POOLS_SCOPE.nuthatchSourceId).toBe("nuthatch-pool-swaps");
    expect(
      getActiveComparePoolGraphSources().some(
        (source) => source.source_id === M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
      ),
    ).toBe(false);
  });
});
