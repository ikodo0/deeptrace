export { normalizeAddress } from "./address.js";
export { convertPoolSourceResult, toPoolComparisonRecord } from "./convert.js";
export { deduplicateCanonicalPools } from "./dedupe.js";
export { NormalizationError } from "./error.js";
export { pairIdentity, poolIdentity, swapEventIdentity, tokenIdentity } from "./identities.js";
export { bindComparePoolsGraphResult, bindComparePoolsGraphResults } from "./live-binding.js";
export { normalizeCanonicalPair, normalizeCanonicalToken } from "./pair.js";
export {
  deduplicateSwapEvents,
  filterSwapsByTokenThreshold,
  normalizeDeduplicateAndFilterSwaps,
  normalizeLssSwapEvent,
  swapMeetsTokenThreshold,
  type LssThresholdToken,
  type RawLssSwapEvent,
} from "./swaps.js";
export { DUPLICATE_POOL_COLLAPSE_POLICY, type CanonicalPoolCandidate } from "./types.js";
export type { SourceTokenInput } from "./pair.js";
