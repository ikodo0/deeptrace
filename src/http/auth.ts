import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = /^Bearer (.+)$/;

/**
 * Compares a presented credential against the expected one without leaking
 * length or content through timing. Returns false for any malformed header.
 *
 * An undefined `sharedToken` means the shared deployment credential has been
 * retired, leaving issued per-client tokens as the only way in.
 */
export function isAuthorized(
  authorizationHeader: string | undefined,
  sharedToken: string | undefined,
  issuedTokens?: { verify(token: string): boolean },
): boolean {
  if (authorizationHeader === undefined) {
    return false;
  }

  const credential = BEARER_PREFIX.exec(authorizationHeader.trim())?.[1];
  if (credential === undefined) {
    return false;
  }

  // Per-client tokens and the shared deployment token are accepted together so
  // existing clients keep working while the shared one is being retired.
  if (issuedTokens?.verify(credential) === true) {
    return true;
  }

  if (sharedToken === undefined) {
    return false;
  }

  const presented = Buffer.from(credential, "utf8");
  const expected = Buffer.from(sharedToken, "utf8");

  // timingSafeEqual throws on length mismatch, so the lengths are compared
  // first. Token length is not secret; the token itself is.
  if (presented.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(presented, expected);
}
