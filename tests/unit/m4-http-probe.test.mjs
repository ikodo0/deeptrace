import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildAcceptance,
  GUARD_QUERY,
  isFreshnessViewAvailable,
  isMaxRowsRejection,
  isProbeAccepted,
  MAX_ROWS_QUERY,
  requireBaseUrl,
} from "../../scripts/m4/http-probe-lib.mjs";

const freshnessColumns = [
  "pool_address",
  "recent_swap_count_24h",
  "last_swap_block",
  "last_swap_block_timestamp",
  "last_swap_block_hash",
  "last_swap_tx_hash",
  "last_swap_log_index",
];

describe("M4 HTTP probe validation", () => {
  it("requires an explicit HTTP(S) Nuthatch base URL", () => {
    expect(() => requireBaseUrl(undefined)).toThrow(/NUTHATCH_BASE_URL is required/);
    expect(() => requireBaseUrl("file:///tmp/nuthatch")).toThrow(/http: or https:/);
    expect(requireBaseUrl("https://nuthatch.example")).toBe("https://nuthatch.example/");
  });

  it("does not treat a catalog miss as max_rows rejection", () => {
    expect(
      isMaxRowsRejection({
        status: 400,
        body: "Catalog Error: Table with name pool_swap_freshness does not exist",
      }),
    ).toBe(false);
  });

  it("recognizes an explicit max_rows ceiling rejection", () => {
    expect(
      isMaxRowsRejection({
        status: 400,
        body: "max_rows must be at most 50000",
      }),
    ).toBe(true);
  });

  it("requires successful SQL and explain probes for the freshness view", () => {
    expect(
      isFreshnessViewAvailable({
        "/sql": { status: 200 },
        "/explain": { status: 200 },
      }),
    ).toBe(true);
    expect(
      isFreshnessViewAvailable({
        "/sql": { status: 400 },
        "/explain": { status: 400 },
      }),
    ).toBe(false);
  });

  it("requires POST /sql rejection for acceptance", () => {
    const accepted = buildAcceptance({
      endpoints: { "/sql": { status: 200 }, "/explain": { status: 200 } },
      maxRows: { rejected: true },
      postSql: { rejected: false },
    });

    expect(accepted.post_sql_rejected).toBe(false);
    expect(isProbeAccepted(accepted)).toBe(false);
  });

  it("runs max_rows and concurrency guards against the existing raw table", () => {
    expect(MAX_ROWS_QUERY).toContain("pool__swap");
    expect(GUARD_QUERY).toContain("pool__swap");
    expect(MAX_ROWS_QUERY).not.toContain("pool_swap_freshness");
    expect(GUARD_QUERY).not.toContain("pool_swap_freshness");
  });
});

describe("M4 committed artifacts", () => {
  it("captures the live nuthatch http surface", async () => {
    const evidence = JSON.parse(
      await readFile(
        new URL("../integration/__evidence__/m4/p0-http-capabilities.json", import.meta.url),
        "utf8",
      ),
    );

    expect(evidence.endpoints["/health"].status).toBe(200);
    expect(evidence.endpoints["/ready"].status).toBe(200);
    expect(evidence.endpoints["/nest"].status).toBe(200);
    expect(evidence.post_sql.rejected).toBe(true);
  });

  it("projects exactly the seven Nuthatch freshness fields", async () => {
    const sql = await readFile(
      new URL("../../nest/views/pool_swap_freshness.sql", import.meta.url),
      "utf8",
    );
    const executableSql = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const projection = sql.slice(sql.indexOf("SELECT") + 6, sql.indexOf("FROM ("));

    for (const column of freshnessColumns) {
      expect(projection).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(projection.match(/\bAS\s+[a-z0-9_]+/gi)).toHaveLength(freshnessColumns.length);
    expect(executableSql).not.toMatch(/\b(?:CURRENT_TIMESTAMP|now)\s*\(/i);
  });
});
