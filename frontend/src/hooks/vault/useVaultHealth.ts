import { useEffect, useMemo, useState } from "react";
import { pwnedCount } from "../../services/vault/pwned.ts";
import type { VaultEntry } from "../../types/vault.ts";
import {
  localEntryHealth,
  mergeLeaked,
  weightedHealthScore,
  type EntryHealth,
} from "../../utils/vault/health.ts";

/**
 * Whether the HIBP leak lookup actually ran to completion this pass.
 * "unavailable" (e.g. the desktop's network boundary blocks HIBP, or the
 * device is offline) must never be shown to the user as "no leaks found" —
 * that would claim a clean result nothing actually checked (#279 review).
 */
export type LeakCheckStatus = "checking" | "complete" | "unavailable";

export function useVaultHealth(entries: VaultEntry[]): {
  health: EntryHealth[];
  score: number | null;
  leakCheckStatus: LeakCheckStatus;
} {
  const local = useMemo(() => localEntryHealth(entries), [entries]);
  const [leakedIds, setLeakedIds] = useState<string[]>([]);
  const [leakCheckStatus, setLeakCheckStatus] = useState<LeakCheckStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    setLeakCheckStatus("checking");
    const snapshot = entries.map((entry) => ({ id: entry.id, password: entry.password }));
    void (async () => {
      const found: string[] = [];
      let anyFailure = false;
      for (const row of snapshot) {
        if (!row.password) continue;
        try {
          if ((await pwnedCount(row.password)) > 0) found.push(row.id);
        } catch {
          // Offline or blocked: skip leaked, keep local weak/reused — but
          // remember this pass could not vouch for a clean result.
          anyFailure = true;
        }
      }
      if (!cancelled) {
        setLeakedIds(found);
        setLeakCheckStatus(anyFailure ? "unavailable" : "complete");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const leakedSet = useMemo(() => new Set(leakedIds), [leakedIds]);
  const health = useMemo(() => mergeLeaked(local, leakedSet), [local, leakedSet]);
  const score = useMemo(() => weightedHealthScore(health), [health]);
  return { health, score, leakCheckStatus };
}
