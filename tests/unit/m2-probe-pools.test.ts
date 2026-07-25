import { describe, expect, it } from "vitest";

import { poolProbeFailureMessage } from "../../scripts/m2/lib/pool-probe.ts";

describe("poolProbeFailureMessage", () => {
  it("preserves explicit transport timeout messages", () => {
    expect(
      poolProbeFailureMessage({
        kind: "timeout",
        message: "Graph gateway request exceeded the 15 second timeout.",
      }),
    ).toBe("Graph gateway request exceeded the 15 second timeout.");
  });

  it("preserves transport and invalid JSON messages", () => {
    expect(
      poolProbeFailureMessage({
        kind: "transport",
        message: "Graph gateway request failed; details were redacted.",
      }),
    ).toBe("Graph gateway request failed; details were redacted.");
    expect(
      poolProbeFailureMessage({
        kind: "invalid_json",
        message: "Graph gateway returned a non-JSON response.",
      }),
    ).toBe("Graph gateway returned a non-JSON response.");
  });

  it("labels successful empty pool responses as incompatible", () => {
    expect(poolProbeFailureMessage(null)).toBe(
      "The common tier query returned no pool; candidate is incompatible.",
    );
  });
});
