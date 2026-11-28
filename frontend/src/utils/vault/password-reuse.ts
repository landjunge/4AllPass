/**
 * Exact password reuse across different services (issue #279 #8).
 *
 * This is deliberately narrower than `health.ts`'s `reused` flag: that flag
 * marks an entry when its password is *merely similar* (Levenshtein distance
 * below a threshold) to any other entry's password, which is a strength/health
 * signal, not a list of exactly which entries share a secret. This module
 * instead groups entries whose password is **byte-for-byte identical**, which
 * is the classic "I used the same password on two different accounts" risk
 * and is what a dedicated security-review panel needs to name concrete
 * entries to fix.
 *
 * Pure and read-only: it only compares the already-unlocked plaintext
 * `password` field already held in memory, never sends it anywhere, and
 * never includes the password value itself in its result — only entry ids
 * and titles.
 */
import type { VaultEntry } from "../../types/vault.ts";

export interface PasswordReuseGroup {
  /** Entries that share this password, oldest-created-first (stable id order). */
  entryIds: string[];
  /** Raw titles in the same order as `entryIds` (may be empty — caller falls back to "untitled"). */
  titles: string[];
}

export function findExactPasswordReuseGroups(entries: VaultEntry[]): PasswordReuseGroup[] {
  const byPassword = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    if (!entry.password) continue;
    const bucket = byPassword.get(entry.password);
    if (bucket) bucket.push(entry);
    else byPassword.set(entry.password, [entry]);
  }
  const groups: PasswordReuseGroup[] = [];
  for (const bucket of byPassword.values()) {
    if (bucket.length < 2) continue;
    groups.push({
      entryIds: bucket.map((entry) => entry.id),
      titles: bucket.map((entry) => entry.title),
    });
  }
  return groups;
}
