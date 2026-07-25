/**
 * Compares the registry-pinned deployment with the deployment reported by
 * `_meta` on the same GraphQL response. M3 maps a mismatch to `unsupported`
 * with null data. Reliable freshness from that response may be retained.
 */
export type DeploymentAssertion =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly expected: string;
      readonly actual: string;
    };

export function assertDeployment(expected: string, actual: string): DeploymentAssertion {
  if (expected === actual) {
    return { ok: true };
  }

  return { ok: false, expected, actual };
}

/**
 * Builds a credential-free diagnostic using only deployment identifiers.
 */
export function deploymentMismatchWarning(expected: string, actual: string): string {
  return `Graph deployment mismatch: expected "${expected}", received "${actual}".`;
}
