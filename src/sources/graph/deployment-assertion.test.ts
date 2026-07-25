import assert from "node:assert/strict";
import test from "node:test";

import { assertDeployment, deploymentMismatchWarning } from "./deployment-assertion.ts";

void test("accepts an exact, case-sensitive deployment match", () => {
  assert.deepEqual(assertDeployment("QmExpected", "QmExpected"), { ok: true });
});

void test("returns both hashes on mismatch", () => {
  assert.deepEqual(assertDeployment("QmExpected", "QmActual"), {
    ok: false,
    expected: "QmExpected",
    actual: "QmActual",
  });
});

void test("treats an omitted deployment as an empty mismatch", () => {
  assert.deepEqual(assertDeployment("QmExpected", ""), {
    ok: false,
    expected: "QmExpected",
    actual: "",
  });
});

void test("warning contains both hashes and no unrelated environment value", () => {
  const credential = "secret-that-must-not-appear";
  const warning = deploymentMismatchWarning("QmExpected", "QmActual");

  assert.match(warning, /QmExpected/);
  assert.match(warning, /QmActual/);
  assert.doesNotMatch(warning, new RegExp(credential));
});
