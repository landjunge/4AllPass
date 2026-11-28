import type { VaultEntry } from "../../types/vault.ts";

/**
 * Duplicate check for the "create a new API key" flow (issue #278). A
 * capture that silently created a second entry for a key already in the
 * vault would be exactly the "silent overwrite/duplicate" the issue rules
 * out, so the UI calls this before offering to apply a captured key and
 * always surfaces the existing entry by name instead of guessing a merge.
 *
 * Two different situations are kept apart:
 * - `exact`: an existing "api" entry already holds this *same* key value
 *   for this provider — almost certainly the very key the user just copied
 *   again (providers that only ever show a key once do not hand out the
 *   same value twice).
 * - `sameAccount`: no identical key, but an existing "api" entry already
 *   uses this provider + account — a likely rotation, not necessarily a
 *   mistake, so it is surfaced the same way (existing entry named, no
 *   silent action) without calling it an exact duplicate.
 */
export interface DuplicateMatch {
  kind: "exact" | "sameAccount";
  entry: VaultEntry;
}

export function findDuplicateKeyEntry(
  entries: readonly VaultEntry[],
  providerName: string,
  account: string,
  password: string,
): DuplicateMatch | null {
  const apiEntries = entries.filter((entry) => entry.kind === "api");
  const sameProvider = apiEntries.filter(
    (entry) => entry.provider.trim().toLowerCase() === providerName.trim().toLowerCase(),
  );
  const exact = sameProvider.find((entry) => entry.password !== "" && entry.password === password);
  if (exact) return { kind: "exact", entry: exact };
  const trimmedAccount = account.trim().toLowerCase();
  if (trimmedAccount) {
    const sameAccount = sameProvider.find((entry) => entry.account.trim().toLowerCase() === trimmedAccount);
    if (sameAccount) return { kind: "sameAccount", entry: sameAccount };
  }
  return null;
}
