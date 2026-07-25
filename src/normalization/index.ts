export { normalizeAddress } from "./address.js";
export { convertPoolSourceResult, toPoolComparisonRecord } from "./convert.js";
export { deduplicateCanonicalPools } from "./dedupe.js";
export { NormalizationError } from "./error.js";
export { pairIdentity, poolIdentity, tokenIdentity } from "./identities.js";
export { bindComparePoolsGraphResult, bindComparePoolsGraphResults } from "./live-binding.js";
export { normalizeCanonicalPair, normalizeCanonicalToken } from "./pair.js";
export { DUPLICATE_POOL_COLLAPSE_POLICY, type CanonicalPoolCandidate } from "./types.js";
export type { SourceTokenInput } from "./pair.js";
