import type { VaultEntry } from "../../types/vault.ts";

export function filterVaultEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [entry.title, entry.username, entry.url, entry.provider, entry.host].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}
