import {
  entriesFromBrowserLogins,
  mergeImportedLogins,
  parsePlaintextExport,
  type BrowserLoginRow,
} from "../../lib/import.ts";
import { looksLikeSharePackage } from "../../lib/share.ts";
import type { ImportPending, ImportSource, VaultEntry } from "../../types/vault.ts";

export type ParsedVaultFile =
  | { type: "share"; text: string }
  | { type: "plaintext"; entries: VaultEntry[] };

export async function parseVaultImportFile(file: File): Promise<ParsedVaultFile> {
  const text = await file.text();
  if (looksLikeSharePackage(text)) return { type: "share", text };
  const parsed = parsePlaintextExport(text);
  if (parsed.entries.length === 0) {
    throw new Error("Keine Logins in dieser Datei. / no login entries in this file");
  }
  return { type: "plaintext", entries: parsed.entries };
}

export function pendingFromEntries(entries: VaultEntry[], source: ImportSource): ImportPending {
  return {
    count: entries.length,
    entries,
    source,
    picked: entries.map((entry) => entry.id),
  };
}

export function browserLoginsToPending(rows: BrowserLoginRow[]): ImportPending | null {
  const incoming = entriesFromBrowserLogins(rows);
  if (incoming.length === 0) return null;
  return pendingFromEntries(incoming, "browser");
}

export function selectedImportEntries(pending: ImportPending): VaultEntry[] {
  return pending.entries.filter((entry) => pending.picked.includes(entry.id));
}

export function mergeImport(
  existing: VaultEntry[],
  chosen: VaultEntry[],
  source: ImportSource,
): VaultEntry[] {
  if (source === "browser") return mergeImportedLogins(existing, chosen);
  return [...existing, ...chosen];
}

export function toggleImportPick(pending: ImportPending, id: string): ImportPending {
  const on = pending.picked.includes(id);
  return {
    ...pending,
    picked: on ? pending.picked.filter((pickedId) => pickedId !== id) : [...pending.picked, id],
  };
}

export function pickAllImport(pending: ImportPending): ImportPending {
  return { ...pending, picked: pending.entries.map((entry) => entry.id) };
}

export function pickNoneImport(pending: ImportPending): ImportPending {
  return { ...pending, picked: [] };
}
