import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Per-client bearer tokens, so one leaked credential revokes alone instead of
 * locking out everyone. Tokens are stored only as SHA-256 digests: the file is
 * enough to revoke a token but not to use one.
 *
 * Lookup is by digest rather than by comparison, so verification cost does not
 * grow with the number of issued tokens and no timing-safe compare is needed —
 * an attacker cannot work backwards from a digest to the secret.
 */

/** Marks the secret for scanners, and makes a leaked string identifiable. */
const TOKEN_PREFIX = "dt_";
const TOKEN_BYTES = 32;

export interface TokenRecord {
  readonly createdAt: number;
  lastUsedAt: number | null;
}

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class TokenStore {
  private readonly records = new Map<string, TokenRecord>();

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      // A missing file is the empty store, not an error: the first mint
      // creates it. Any other read failure surfaces on the next write.
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Starting empty would revoke every issued token silently, so the
      // corruption is announced on stderr. stdout carries MCP frames.
      console.error(`[deeptrace] Ignoring unreadable token store at ${this.path}`);
      return;
    }
    if (parsed === null || typeof parsed !== "object") {
      return;
    }
    for (const [hash, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") {
        continue;
      }
      const record = value as Partial<TokenRecord>;
      if (typeof record.createdAt !== "number") {
        continue;
      }
      this.records.set(hash, {
        createdAt: record.createdAt,
        lastUsedAt: typeof record.lastUsedAt === "number" ? record.lastUsedAt : null,
      });
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.records)), {
      encoding: "utf8",
      mode: 0o600,
    });
    // writeFileSync only applies mode when it creates the file, so an existing
    // file keeps whatever permissions it had.
    chmodSync(this.path, 0o600);
  }

  /** Returns the plaintext token. It is never recoverable after this call. */
  mint(): string {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
    this.records.set(digest(token), { createdAt: this.now(), lastUsedAt: null });
    this.persist();
    return token;
  }

  verify(presented: string): boolean {
    const record = this.records.get(digest(presented));
    if (record === undefined) {
      return false;
    }
    record.lastUsedAt = this.now();
    return true;
  }

  revoke(hash: string): boolean {
    if (!this.records.delete(hash)) {
      return false;
    }
    this.persist();
    return true;
  }

  size(): number {
    return this.records.size;
  }
}
