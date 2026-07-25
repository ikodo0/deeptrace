import assert from "node:assert/strict";
import test from "node:test";

import { postGraphQuery } from "./gateway.ts";
import { metaQuery } from "./queries.ts";

void test("posts bearer-authenticated GraphQL without putting the key in the URL", async () => {
  const credential = "test-credential";
  let observedUrl = "";
  let observedAuthorization = "";

  const fetchImpl: typeof fetch = (input, init) => {
    observedUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            _meta: {
              deployment: "QmDummy",
              block: { number: 1, timestamp: 1, hash: "0x01" },
              hasIndexingErrors: false,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };

  const result = await postGraphQuery(
    "dummy-id",
    metaQuery,
    {},
    {
      apiKey: credential,
      fetchImpl,
      gatewayOrigin: "https://dummy.invalid/api",
    },
  );

  assert.equal(observedUrl, "https://dummy.invalid/api/subgraphs/id/dummy-id");
  assert.equal(observedAuthorization, `Bearer ${credential}`);
  assert.doesNotMatch(observedUrl, new RegExp(credential));
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
});

void test("redacts transport exception details", async () => {
  const credential = "must-not-leak";
  const fetchImpl: typeof fetch = () =>
    Promise.reject(new Error(`network failed with ${credential}`));
  const result = await postGraphQuery(
    "dummy-id",
    metaQuery,
    {},
    {
      apiKey: credential,
      fetchImpl,
    },
  );

  assert.equal(result.error?.kind, "transport");
  assert.doesNotMatch(result.error?.message ?? "", new RegExp(credential));
});
