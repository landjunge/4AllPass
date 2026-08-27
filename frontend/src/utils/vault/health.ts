import zxcvbn from "zxcvbn";
import type { VaultEntry } from "../../types/vault.ts";
import { CATEGORY_WEIGHT, classifyEntry, type EntryCategory } from "./category.ts";

export type HealthIssue = "leaked" | "reused" | "weak";

export interface EntryHealth {
  id: string;
  category: EntryCategory;
  weight: number;
  issues: HealthIssue[];
}

const ZXCVBN_WEAK_MAX = 2;
const SIMILAR_DISTANCE = 3;
export const HEALTH_MIN_ENTRIES = 5;

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i += 1) {
    const row = grid[i];
    if (!row) continue;
    row[0] = i;
  }
  const first = grid[0];
  if (first) {
    for (let j = 0; j < cols; j += 1) first[j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cur = grid[i];
      const prev = grid[i - 1];
      if (!cur || !prev) continue;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
  }
  return grid[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

export function isZxcvbnWeak(password: string): boolean {
  if (!password) return false;
  return zxcvbn(password).score <= ZXCVBN_WEAK_MAX;
}

export function reusedOrSimilar(entries: VaultEntry[], index: number): boolean {
  const mine = entries[index]?.password ?? "";
  if (!mine) return false;
  return entries.some((other, otherIndex) => {
    if (otherIndex === index || !other.password) return false;
    return levenshtein(mine, other.password) < SIMILAR_DISTANCE;
  });
}

export function localEntryHealth(entries: VaultEntry[]): EntryHealth[] {
  return entries.map((entry, index) => {
    const category = classifyEntry(entry);
    const issues: HealthIssue[] = [];
    if (isZxcvbnWeak(entry.password)) issues.push("weak");
    if (reusedOrSimilar(entries, index)) issues.push("reused");
    return { id: entry.id, category, weight: CATEGORY_WEIGHT[category], issues };
  });
}

export function mergeLeaked(health: EntryHealth[], leakedIds: ReadonlySet<string>): EntryHealth[] {
  return health.map((row) =>
    leakedIds.has(row.id) && !row.issues.includes("leaked")
      ? { ...row, issues: ["leaked", ...row.issues] }
      : row,
  );
}

/** 0–100. Safe entries keep their category weight; any issue zeroes that weight. */
export function weightedHealthScore(health: EntryHealth[]): number | null {
  if (health.length < HEALTH_MIN_ENTRIES) return null;
  const total = health.reduce((sum, row) => sum + row.weight, 0);
  if (total === 0) return 100;
  const safe = health.reduce((sum, row) => sum + (row.issues.length === 0 ? row.weight : 0), 0);
  return Math.round((100 * safe) / total);
}

export function issueRank(issues: HealthIssue[]): number {
  if (issues.includes("leaked")) return 3;
  if (issues.includes("reused")) return 2;
  if (issues.includes("weak")) return 1;
  return 0;
}

export function groupVaultSections(
  entries: VaultEntry[],
  health: EntryHealth[],
): {
  favorites: VaultEntry[];
  attention: VaultEntry[];
  recent: VaultEntry[];
} {
  const byId = new Map(health.map((row) => [row.id, row]));
  const favorites = entries
    .filter((entry) => entry.favorite)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const favoriteIds = new Set(favorites.map((entry) => entry.id));
  const attention = entries
    .filter((entry) => !favoriteIds.has(entry.id) && (byId.get(entry.id)?.issues.length ?? 0) > 0)
    .sort((a, b) => {
      const left = byId.get(a.id);
      const right = byId.get(b.id);
      const risk =
        issueRank(right?.issues ?? []) * (right?.weight ?? 1) -
        issueRank(left?.issues ?? []) * (left?.weight ?? 1);
      return risk !== 0 ? risk : b.updatedAt.localeCompare(a.updatedAt);
    });
  const taken = new Set([...favoriteIds, ...attention.map((entry) => entry.id)]);
  const recent = entries
    .filter((entry) => !taken.has(entry.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { favorites, attention, recent };
}
