import { useMemo, useState } from "react";
import type { VaultEntry } from "../../types/vault.ts";
import { filterVaultEntries } from "../../utils/vault/search.ts";

export function useVaultSearch(entries: VaultEntry[]): {
  query: string;
  setQuery: (query: string) => void;
  filtered: VaultEntry[];
} {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterVaultEntries(entries, query), [entries, query]);
  return { query, setQuery, filtered };
}
