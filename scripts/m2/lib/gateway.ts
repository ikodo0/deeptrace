import { readFile } from "node:fs/promises";

import type { QueryTemplate } from "./queries.ts";

export const GATEWAY_HOST = "gateway.thegraph.com" as const;
const GATEWAY_ORIGIN = `https://${GATEWAY_HOST}/api`;
const TIMEOUT_MS = 15_000;

export interface GraphResponse {
  readonly status: number | null;
  readonly body: unknown;
  readonly error: {
    readonly kind: "timeout" | "transport" | "invalid_json";
    readonly message: string;
  } | null;
  readonly latencyMs: number;
}

function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const name = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }
  return values;
}

export async function loadGraphApiKey(envPath = ".env"): Promise<string> {
  const fileValues = parseEnv(await readFile(envPath, "utf8"));
  const key = process.env.GRAPH_API_KEY ?? fileValues.get("GRAPH_API_KEY");
  if (!key) {
    throw new Error("GRAPH_API_KEY is unset or empty.");
  }
  return key;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Graph gateway request exceeded the 15 second timeout.";
  }
  return "Graph gateway request failed; details were redacted.";
}

export async function postGraphQuery(
  subgraphId: string,
  template: QueryTemplate,
  variables: Readonly<Record<string, unknown>> = {},
  options: {
    readonly apiKey?: string;
    readonly fetchImpl?: typeof fetch;
    readonly gatewayOrigin?: string;
  } = {},
): Promise<GraphResponse> {
  const apiKey = options.apiKey ?? (await loadGraphApiKey());
  const fetchImpl = options.fetchImpl ?? fetch;
  const gatewayOrigin = options.gatewayOrigin ?? GATEWAY_ORIGIN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetchImpl(
      `${gatewayOrigin}/subgraphs/id/${encodeURIComponent(subgraphId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: template.query, variables }),
        signal: controller.signal,
      },
    );
    const text = await response.text();
    try {
      return {
        status: response.status,
        body: JSON.parse(text) as unknown,
        error: null,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch {
      return {
        status: response.status,
        body: null,
        error: {
          kind: "invalid_json",
          message: "Graph gateway returned a non-JSON response.",
        },
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: null,
      body: null,
      error: {
        kind: timedOut ? "timeout" : "transport",
        message: safeErrorMessage(error),
      },
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}
