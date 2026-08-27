import type { EntryKind, Translate, VaultEntry } from "../../types/vault.ts";

export function kindLabel(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "API-Key", en: "API key" });
  if (kind === "sftp") return t({ de: "Server-Zugang", en: "Server login" });
  return t({ de: "Login", en: "Login" });
}

export function entryDisplayTitle(entry: VaultEntry, untitled: string): string {
  return entry.title || entry.url || entry.host || untitled;
}

export function entrySecondaryLine(entry: VaultEntry, kind: string): string {
  const who = entry.username || entry.account || entry.host;
  return who ? `${kind} · ${who}` : kind;
}

export function newEntryHeading(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "Neuer API-Key", en: "New API key" });
  if (kind === "sftp") return t({ de: "Neuer Server-Zugang", en: "New server login" });
  return t({ de: "Neuer Login", en: "New login" });
}
