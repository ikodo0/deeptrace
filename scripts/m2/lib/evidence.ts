import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { GATEWAY_HOST, type GraphResponse } from "./gateway.ts";
import type { QueryTemplate } from "./queries.ts";

export const EVIDENCE_ROOT = "tests/integration/__evidence__/m2";

export interface EvidenceDocument {
  readonly captured_at: string;
  readonly gateway_host: typeof GATEWAY_HOST;
  readonly subgraph_id: string;
  readonly query_id: string;
  readonly request: {
    readonly query: string;
    readonly variables: Readonly<Record<string, unknown>>;
  };
  readonly response: unknown;
  readonly transport: {
    readonly http_status: number | null;
    readonly latency_ms: number;
    readonly error: GraphResponse["error"];
  };
}

export async function writeEvidence(
  slug: string,
  filename: string,
  subgraphId: string,
  template: QueryTemplate,
  variables: Readonly<Record<string, unknown>>,
  result: GraphResponse,
  root = EVIDENCE_ROOT,
): Promise<void> {
  const directory = path.join(root, slug);
  await mkdir(directory, { recursive: true });
  const document: EvidenceDocument = {
    captured_at: new Date().toISOString(),
    gateway_host: GATEWAY_HOST,
    subgraph_id: subgraphId,
    query_id: template.queryId,
    request: { query: template.query, variables },
    response: result.body,
    transport: {
      http_status: result.status,
      latency_ms: result.latencyMs,
      error: result.error,
    },
  };
  await writeFile(path.join(directory, filename), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export async function readManifest(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path.join(EVIDENCE_ROOT, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeManifest(manifest: Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_ROOT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export async function politeGap(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}
