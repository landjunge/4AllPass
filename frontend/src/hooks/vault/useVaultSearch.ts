import { useMemo, useState } from "react";
import type { VaultEntry, VaultListFilter } from "../../types/vault.ts";
import { filterVaultEntries } from "../../utils/vault/search.ts";
import { countWeakSecrets } from "../../utils/vault/strength.ts";

export function useVaultSearch(entries: VaultEntry[]): {
  query: string;
  setQuery: (query: string) => void;
  kind: VaultListFilter;
  setKind: (kind: VaultListFilter) => void;
  filtered: VaultEntry[];
  weakCount: number;
} {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<VaultListFilter>("all");
  const filtered = useMemo(() => filterVaultEntries(entries, query, kind), [entries, query, kind]);
  const weakCount = useMemo(
    () => countWeakSecrets(entries.map((entry) => entry.password)),
    [entries],
  );
  return { query, setQuery, kind, setKind, filtered, weakCount };
}
