import { describe, expect, it } from "vitest";

import {
  assertDeployment,
  deploymentMismatchWarning,
} from "../../src/sources/graph/deployment-assertion.js";

describe("assertDeployment", () => {
  it("accepts an exact, case-sensitive deployment match", () => {
    expect(assertDeployment("QmExpected", "QmExpected")).toEqual({ ok: true });
  });

  it("returns both hashes on mismatch", () => {
    expect(assertDeployment("QmExpected", "QmActual")).toEqual({
      ok: false,
      expected: "QmExpected",
      actual: "QmActual",
    });
  });

  it("treats an omitted deployment as an empty mismatch", () => {
    expect(assertDeployment("QmExpected", "")).toEqual({
      ok: false,
      expected: "QmExpected",
      actual: "",
    });
  });
});

describe("deploymentMismatchWarning", () => {
  it("contains both hashes and no unrelated environment value", () => {
    const credential = "secret-that-must-not-appear";
    const warning = deploymentMismatchWarning("QmExpected", "QmActual");

    expect(warning).toMatch(/QmExpected/);
    expect(warning).toMatch(/QmActual/);
    expect(warning).not.toMatch(new RegExp(credential));
  });
});
