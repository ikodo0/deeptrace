import { GATEWAY_DEFAULTS } from "../../config/defaults.js";

export const GRAPH_GATEWAY_ORIGIN = "https://gateway.thegraph.com/api" as const;

export interface GraphTransportError {
  readonly kind: "timeout" | "transport" | "invalid_json" | "http";
  readonly message: string;
}

export interface GraphTransportResult {
  readonly status: number | null;
  readonly body: unknown;
  readonly error: GraphTransportError | null;
  readonly latencyMs: number;
}

export interface PostGraphGatewayOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly gatewayOrigin?: string;
}

function safeTransportMessage(error: unknown, timedOut: boolean): string {
  if (timedOut) {
    return "Graph gateway request exceeded the configured timeout.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Graph gateway request was aborted.";
  }
  return "Graph gateway request failed; details were redacted.";
}

/**
 * POSTs a GraphQL document to a Graph Network gateway subgraph endpoint.
 * Authorization uses a Bearer header; the API key never appears in the URL.
 */
export async function postGraphGateway(
  subgraphId: string,
  query: string,
  variables: Readonly<Record<string, unknown>>,
  options: PostGraphGatewayOptions,
): Promise<GraphTransportResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const gatewayOrigin = options.gatewayOrigin ?? GRAPH_GATEWAY_ORIGIN;
  const timeoutMs = options.timeoutMs ?? GATEWAY_DEFAULTS.sourceTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetchImpl(
      `${gatewayOrigin}/subgraphs/id/${encodeURIComponent(subgraphId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      },
    );
    const text = await response.text();
    try {
      const body = JSON.parse(text) as unknown;
      if (response.status < 200 || response.status >= 300) {
        return {
          status: response.status,
          body,
          error: {
            kind: "http",
            message: `Graph gateway returned HTTP ${String(response.status)}.`,
          },
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }
      return {
        status: response.status,
        body,
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
        message: safeTransportMessage(error, timedOut),
      },
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}
