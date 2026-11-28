/**
 * Verwendungsübersicht (#279 Punkt 6): purely manual bookkeeping. 4AllPass
 * cannot see which local tool actually uses a stored key — there is no
 * automatic detection here, on purpose (that would mean comparing secret
 * values outside the vault). This only formats/parses what the user typed
 * into the "used by" field and decides when the delete-time warning shows.
 */
import type { VaultEntry } from "../../lib/entries.ts";

/** One tool/project name per line (or comma-separated on one line) → a clean list. */
export function parseUsedByInput(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Textarea value for an existing list — one name per line. */
export function formatUsedByInput(usedBy: readonly string[]): string {
  return usedBy.join("\n");
}

/** True only when the entry names at least one dependent tool/project. */
export function hasUsageDependents(entry: Pick<VaultEntry, "usedBy">): boolean {
  return entry.usedBy.length > 0;
}
