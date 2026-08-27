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

/** Display host for the list icon. Not a trust signal. */
export function entryIconName(entry: VaultEntry): string {
  const host = (
    entry.domain ||
    entry.host ||
    hostFromUrl(entry.url) ||
    entry.provider ||
    entry.title
  ).trim();
  return host.replace(/^www\./i, "") || "?";
}

export function entryMetaLine(entry: VaultEntry, kind: string): string {
  const who = entry.username || entry.account;
  const where = entry.domain || entry.host || hostFromUrl(entry.url);
  const parts = [who, where].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : kind;
}

function hostFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const href = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(href).hostname;
  } catch {
    return "";
  }
}

export function newEntryHeading(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "Neuer API-Key", en: "New API key" });
  if (kind === "sftp") return t({ de: "Neuer Server-Zugang", en: "New server login" });
  return t({ de: "Neuer Login", en: "New login" });
}
