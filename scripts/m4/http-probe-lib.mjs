const MAX_ROWS_ERROR =
  /(?:max[_ ]rows|maximum rows|row limit).*(?:50000|50,000|exceed|at most|less)/i;

export const GUARD_QUERY = "SELECT count(*) FROM pool__swap a, pool__swap b, pool__swap c";
export const MAX_ROWS_QUERY = "SELECT * FROM pool__swap LIMIT 1";

export function requireBaseUrl(value) {
  if (!value) {
    throw new Error("NUTHATCH_BASE_URL is required (for example, http://127.0.0.1:8288).");
  }

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NUTHATCH_BASE_URL must use http: or https:.");
  }
  return url.toString();
}

export function isMaxRowsRejection(result) {
  return (
    result.status !== null &&
    result.status >= 400 &&
    result.status < 500 &&
    typeof result.body === "string" &&
    MAX_ROWS_ERROR.test(result.body)
  );
}

export function isFreshnessViewAvailable(endpoints) {
  return endpoints["/sql"]?.status === 200 && endpoints["/explain"]?.status === 200;
}

export function buildAcceptance({ endpoints, maxRows, postSql }) {
  return {
    freshness_view_available: isFreshnessViewAvailable(endpoints),
    max_rows_rejection_verified: maxRows.rejected,
    post_sql_rejected: postSql.rejected,
  };
}

export function isProbeAccepted(acceptance) {
  return Object.values(acceptance).every(Boolean);
}
