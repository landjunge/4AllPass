import { useEffect, useMemo, useState } from "react";
import { pwnedCount } from "../../services/vault/pwned.ts";
import type { VaultEntry } from "../../types/vault.ts";
import {
  localEntryHealth,
  mergeLeaked,
  weightedHealthScore,
  type EntryHealth,
} from "../../utils/vault/health.ts";

export function useVaultHealth(entries: VaultEntry[]): {
  health: EntryHealth[];
  score: number | null;
} {
  const local = useMemo(() => localEntryHealth(entries), [entries]);
  const [leakedIds, setLeakedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const snapshot = entries.map((entry) => ({ id: entry.id, password: entry.password }));
    void (async () => {
      const found: string[] = [];
      for (const row of snapshot) {
        if (!row.password) continue;
        try {
          if ((await pwnedCount(row.password)) > 0) found.push(row.id);
        } catch {
          // Offline or blocked: skip leaked, keep local weak/reused.
        }
      }
      if (!cancelled) setLeakedIds(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const leakedSet = useMemo(() => new Set(leakedIds), [leakedIds]);
  const health = useMemo(() => mergeLeaked(local, leakedSet), [local, leakedSet]);
  const score = useMemo(() => weightedHealthScore(health), [health]);
  return { health, score };
}
