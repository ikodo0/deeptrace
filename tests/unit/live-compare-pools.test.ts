import { describe, expect, it } from "vitest";

import { comparePoolsResponseSchema } from "../../src/schemas/index.js";
import { M0_COMPARE_POOLS_SCOPE } from "../../src/scope/index.js";
import {
  liveComparePoolsFixtures,
  livePartialComparePoolsFixture,
} from "../fixtures/live-compare-pools.js";
import { graphPoolA, graphPoolB } from "../fixtures/sources/index.js";

describe("live-derived compare_pools fixtures", () => {
  it("accepts Graph-only live fixtures with explicit missing Nuthatch", () => {
    for (const fixture of liveComparePoolsFixtures) {
      expect(comparePoolsResponseSchema.parse(fixture)).toEqual(fixture);
      expect(fixture.coverage.requested_deployments).toBe(2);
      expect(fixture.coverage.nuthatch_available).toBe(false);
      expect(fixture.status).not.toBe("complete");
    }
  });

  it("uses locked Graph source and pool identities", () => {
    const [partial] = liveComparePoolsFixtures;
    expect(partial.data?.pair[0].address).toBe(M0_COMPARE_POOLS_SCOPE.token0.address);
    expect(partial.data?.pair[1].address).toBe(M0_COMPARE_POOLS_SCOPE.token1.address);
    expect(partial.provenance.map((entry) => entry.source_id)).toEqual([
      ...M0_COMPARE_POOLS_SCOPE.graphSources.map((source) => source.source_id),
      M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
    ]);
  });

  it("orders the both-graphs-ok fixture by volume_usd descending", () => {
    const pools = livePartialComparePoolsFixture.data.pools;
    expect(pools[0]?.rank).toBe(1);
    expect(pools[1]?.rank).toBe(2);
    expect(pools[0]?.source_ids).toEqual([graphPoolA.source_id]);
    expect(pools[1]?.source_ids).toEqual([graphPoolB.source_id]);
    expect(pools[0]?.volume_usd).toBe(graphPoolA.data.volume_usd_24h);
    expect(pools[1]?.volume_usd).toBe(graphPoolB.data.volume_usd_24h);
  });

  it("does not invent a verified Nuthatch freshness fact", () => {
    for (const fixture of liveComparePoolsFixtures) {
      if (fixture.data !== null) {
        expect(fixture.data.nuthatch_freshness_fact).toBeNull();
      }
      const nuthatchFreshness = fixture.freshness.find(
        (entry) => entry.source_id === M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
      );
      expect(nuthatchFreshness).toEqual({
        source_id: M0_COMPARE_POOLS_SCOPE.nuthatchSourceId,
        status: "unavailable",
      });
    }
  });
});
