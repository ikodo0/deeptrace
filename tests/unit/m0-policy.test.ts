import { describe, expect, it } from "vitest";

import { GATEWAY_DEFAULTS, GATEWAY_MAXIMUMS } from "../../src/config/index.js";
import {
  M0_CORE_POLICY,
  M0_RANKING_METRICS,
  M0_RANKING_TIE_BREAK,
  M0_TIME_WINDOWS,
  M0_WARNING_ORDER,
} from "../../src/policy/index.js";
import { BASE_CHAIN_ID } from "../../src/schemas/source-adapter.js";

describe("M0 core policy", () => {
  it("locks request defaults and bounds without live source selections", () => {
    expect(M0_CORE_POLICY.chainId).toBe(BASE_CHAIN_ID);
    expect(M0_TIME_WINDOWS).toEqual(["24h", "7d"]);
    expect(M0_CORE_POLICY.defaultWindow).toBe("24h");
    expect(M0_RANKING_METRICS).toEqual(["tvl_usd", "volume_usd", "fees_usd"]);
    expect(M0_CORE_POLICY.defaultRankingMetric).toBe("volume_usd");
    expect(M0_CORE_POLICY.topN).toEqual({ default: 3, maximum: 3 });
    expect(M0_CORE_POLICY).not.toHaveProperty("pair");
    expect(M0_CORE_POLICY).not.toHaveProperty("deployments");
    expect(M0_CORE_POLICY).not.toHaveProperty("nuthatch");
  });

  it("locks deterministic tie-breaking", () => {
    expect(M0_RANKING_TIE_BREAK).toEqual([
      "requested_metric_desc_nulls_last",
      "protocol_asc",
      "pool_address_asc",
      "source_id_asc",
    ]);
    expect(M0_WARNING_ORDER).toEqual(["source_order", "warning_text"]);
  });

  it("locks complete, partial, and failed coverage boundaries", () => {
    expect(M0_CORE_POLICY.coverage).toEqual({
      expectedGraphResults: 2,
      requiresNuthatchForComplete: true,
      minimumGraphResultsForPartial: 1,
    });
  });

  it("keeps executable gateway policy aligned with configuration", () => {
    expect(M0_CORE_POLICY.gateway.rateLimit.defaultMaxRequests).toBe(
      GATEWAY_DEFAULTS.rateLimitMaxRequests,
    );
    expect(M0_CORE_POLICY.gateway.rateLimit.maximumMaxRequests).toBe(
      GATEWAY_MAXIMUMS.rateLimitMaxRequests,
    );
    expect(M0_CORE_POLICY.gateway.rateLimit.defaultWindowMs).toBe(
      GATEWAY_DEFAULTS.rateLimitWindowMs,
    );
    expect(M0_CORE_POLICY.gateway.rateLimit.maximumWindowMs).toBe(
      GATEWAY_MAXIMUMS.rateLimitWindowMs,
    );
    expect(M0_CORE_POLICY.gateway.sourceTimeoutMs).toBe(GATEWAY_DEFAULTS.sourceTimeoutMs);
    expect(M0_CORE_POLICY.gateway.maximumSourceTimeoutMs).toBe(GATEWAY_MAXIMUMS.sourceTimeoutMs);
    expect(M0_CORE_POLICY.gateway.rateLimit.resetPolicy).toBe("fixed_window");
    expect(M0_CORE_POLICY.gateway.endToEndTimeoutMs).toBe(15_000);
    expect(M0_CORE_POLICY.gateway.maximumResponseBytes).toBe(65_536);
  });

  it("locks freshness and reasoning limits", () => {
    expect(M0_CORE_POLICY.freshness).toEqual({
      qualityStaleAfterSeconds: 300,
      enforcementLayer: "core_quality",
      preservesAdapterStatus: true,
    });
    expect(M0_CORE_POLICY.reasoning).toEqual({
      maximumProviderAttempts: 2,
      providerAttemptTimeoutMs: 2_000,
      totalTimeoutMs: 5_000,
      maximumInputBytes: 32_768,
      maximumOutputBytes: 8_192,
      maximumHighlights: 5,
      maximumCaveats: 5,
    });
  });

  it("fits source and provider attempts inside their total deadlines", () => {
    expect(
      M0_CORE_POLICY.reasoning.maximumProviderAttempts *
        M0_CORE_POLICY.reasoning.providerAttemptTimeoutMs,
    ).toBeLessThanOrEqual(M0_CORE_POLICY.reasoning.totalTimeoutMs);
    expect(
      M0_CORE_POLICY.gateway.maximumSourceTimeoutMs + M0_CORE_POLICY.reasoning.totalTimeoutMs,
    ).toBeLessThanOrEqual(M0_CORE_POLICY.gateway.endToEndTimeoutMs);
  });
});
