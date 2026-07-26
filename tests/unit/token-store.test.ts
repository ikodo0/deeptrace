import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isAuthorized } from "../../src/http/auth.js";
import { TokenStore } from "../../src/http/token-store.js";

function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), "deeptrace-tokens-")), "tokens.json");
}

describe("TokenStore", () => {
  it("mints a prefixed token that verifies", () => {
    const store = new TokenStore(storePath());
    const token = store.mint();

    expect(token.startsWith("dt_")).toBe(true);
    expect(store.verify(token)).toBe(true);
    expect(store.size()).toBe(1);
  });

  it("mints a distinct token every time", () => {
    const store = new TokenStore(storePath());
    const tokens = new Set([store.mint(), store.mint(), store.mint()]);

    expect(tokens.size).toBe(3);
    expect(store.size()).toBe(3);
  });

  it("rejects a token it never issued", () => {
    const store = new TokenStore(storePath());
    store.mint();

    expect(store.verify("dt_not-a-real-token")).toBe(false);
    expect(store.verify("")).toBe(false);
  });

  it("never writes the plaintext token to disk", () => {
    const path = storePath();
    const store = new TokenStore(path);
    const token = store.mint();
    const onDisk = readFileSync(path, "utf8");

    expect(onDisk).not.toContain(token);
    expect(onDisk).toContain(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("keeps the store file owner-only", () => {
    const path = storePath();
    new TokenStore(path).mint();

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("restores issued tokens from disk", () => {
    const path = storePath();
    const token = new TokenStore(path).mint();

    expect(new TokenStore(path).verify(token)).toBe(true);
  });

  it("tightens permissions on a store file that was left readable", () => {
    const path = storePath();
    writeFileSync(path, "{}", "utf8");
    chmodSync(path, 0o644);
    new TokenStore(path).mint();

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("revokes one token without affecting the others", () => {
    const path = storePath();
    const store = new TokenStore(path);
    const kept = store.mint();
    const revoked = store.mint();

    expect(store.revoke(createHash("sha256").update(revoked, "utf8").digest("hex"))).toBe(true);
    expect(store.verify(revoked)).toBe(false);
    expect(store.verify(kept)).toBe(true);
    expect(new TokenStore(path).verify(revoked)).toBe(false);
  });

  it("records last use, leaving it null until first verified", () => {
    const path = storePath();
    const store = new TokenStore(path, () => 1_700_000_000_000);
    const token = store.mint();

    const persisted = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(Object.values(persisted)).toEqual([{ createdAt: 1_700_000_000_000, lastUsedAt: null }]);
    store.verify(token);
    expect(store.verify(token)).toBe(true);
  });

  it("treats an unreadable or malformed store as empty", () => {
    const path = storePath();
    writeFileSync(path, "not json at all", "utf8");

    expect(() => new TokenStore(path)).not.toThrow();
    expect(new TokenStore(join(storePath(), "missing", "tokens.json")).size()).toBe(0);
  });
});

describe("isAuthorized with issued tokens", () => {
  const shared = "s".repeat(40);

  it("accepts a minted token alongside the shared one", () => {
    const store = new TokenStore(storePath());
    const token = store.mint();

    expect(isAuthorized(`Bearer ${token}`, shared, store)).toBe(true);
    expect(isAuthorized(`Bearer ${shared}`, shared, store)).toBe(true);
  });

  it("rejects an unknown token even when a store is present", () => {
    const store = new TokenStore(storePath());
    store.mint();

    expect(isAuthorized(`Bearer dt_${randomUUID()}`, shared, store)).toBe(false);
  });

  it("still rejects a minted token presented without the bearer scheme", () => {
    const store = new TokenStore(storePath());
    const token = store.mint();

    expect(isAuthorized(token, shared, store)).toBe(false);
    expect(isAuthorized(`Basic ${token}`, shared, store)).toBe(false);
  });

  it("behaves exactly as before when no store is supplied", () => {
    expect(isAuthorized(`Bearer ${shared}`, shared)).toBe(true);
    expect(isAuthorized("Bearer nope", shared)).toBe(false);
  });

  it("carries every client on minted tokens once the shared one is retired", () => {
    const store = new TokenStore(storePath());
    const token = store.mint();

    expect(isAuthorized(`Bearer ${token}`, undefined, store)).toBe(true);
    expect(isAuthorized(`Bearer ${shared}`, undefined, store)).toBe(false);
  });

  it("revoking a minted token locks out only that client", () => {
    const store = new TokenStore(storePath());
    const kept = store.mint();
    const leaked = store.mint();

    expect(store.revoke(createHash("sha256").update(leaked, "utf8").digest("hex"))).toBe(true);
    expect(isAuthorized(`Bearer ${leaked}`, undefined, store)).toBe(false);
    expect(isAuthorized(`Bearer ${kept}`, undefined, store)).toBe(true);
  });
});
