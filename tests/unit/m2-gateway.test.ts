import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadGraphApiKey, postGraphQuery } from "../../scripts/m2/lib/gateway.ts";
import { metaQuery } from "../../scripts/m2/lib/queries.ts";

const ORIGINAL_GRAPH_API_KEY = process.env.GRAPH_API_KEY;

afterEach(() => {
  if (ORIGINAL_GRAPH_API_KEY === undefined) {
    delete process.env.GRAPH_API_KEY;
  } else {
    process.env.GRAPH_API_KEY = ORIGINAL_GRAPH_API_KEY;
  }
});

describe("loadGraphApiKey", () => {
  it("prefers process environment over a .env file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deeptrace-m2-key-"));
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "GRAPH_API_KEY=from-file\n", "utf8");
    process.env.GRAPH_API_KEY = "from-env";

    await expect(loadGraphApiKey(envPath)).resolves.toBe("from-env");
  });

  it("reads .env when the process environment is unset", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deeptrace-m2-key-"));
    const envPath = path.join(root, ".env");
    await writeFile(envPath, "GRAPH_API_KEY=from-file\n", "utf8");
    delete process.env.GRAPH_API_KEY;

    await expect(loadGraphApiKey(envPath)).resolves.toBe("from-file");
  });

  it("allows a missing .env when GRAPH_API_KEY is already set", async () => {
    process.env.GRAPH_API_KEY = "from-env-only";
    await expect(
      loadGraphApiKey(path.join(os.tmpdir(), "deeptrace-missing-env-file")),
    ).resolves.toBe("from-env-only");
  });

  it("rejects when neither process env nor .env provides a key", async () => {
    delete process.env.GRAPH_API_KEY;
    await expect(
      loadGraphApiKey(path.join(os.tmpdir(), "deeptrace-missing-env-file")),
    ).rejects.toThrow(/GRAPH_API_KEY is unset or empty/);
  });
});

describe("postGraphQuery", () => {
  it("posts bearer-authenticated GraphQL without putting the key in the URL", async () => {
    const credential = "test-credential";
    let observedUrl = "";
    let observedAuthorization = "";

    const fetchImpl: typeof fetch = (input, init) => {
      observedUrl =
        input instanceof Request ? input.url : input instanceof URL ? input.href : input;
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

    expect(observedUrl).toBe("https://dummy.invalid/api/subgraphs/id/dummy-id");
    expect(observedAuthorization).toBe(`Bearer ${credential}`);
    expect(observedUrl).not.toMatch(new RegExp(credential));
    expect(result.status).toBe(200);
    expect(result.error).toBeNull();
  });

  it("redacts transport exception details", async () => {
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

    expect(result.error?.kind).toBe("transport");
    expect(result.error?.message ?? "").not.toMatch(new RegExp(credential));
  });
});
