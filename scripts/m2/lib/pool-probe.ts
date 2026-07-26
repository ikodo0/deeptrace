import type { GraphResponse } from "./gateway.ts";

export function poolProbeFailureMessage(error: GraphResponse["error"]): string {
  return error
    ? error.message
    : "The common tier query returned no pool; candidate is incompatible.";
}
