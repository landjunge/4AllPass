import type { VaultEntry, VaultListFilter } from "../../types/vault.ts";
import { isZxcvbnWeak } from "./health.ts";

export function filterVaultEntries(
  entries: VaultEntry[],
  query: string,
  kind: VaultListFilter = "all",
): VaultEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (kind === "weak") {
      if (!isZxcvbnWeak(entry.password)) return false;
    } else if (kind !== "all" && entry.kind !== kind) {
      return false;
    }
    if (!needle) return true;
    return [entry.title, entry.username, entry.url, entry.provider, entry.host].some((field) =>
      field.toLowerCase().includes(needle),
    );
  });
}
