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

export function formatUpdatedAt(iso: string): string {
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return iso;
  return new Date(stamp).toISOString().slice(0, 10);
}

export function formatRelativeChanged(iso: string, nowMs: number, t: Translate): string {
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return iso;
  const minutes = Math.max(0, Math.floor((nowMs - stamp) / 60_000));
  if (minutes < 1) return t({ de: "gerade eben", en: "just now" });
  if (minutes < 60) {
    return t({ de: `vor ${minutes} Minuten`, en: `${minutes} minutes ago` });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t({ de: `vor ${hours} Stunden`, en: `${hours} hours ago` });
  const days = Math.floor(hours / 24);
  if (days < 30) return t({ de: `vor ${days} Tagen`, en: `${days} days ago` });
  return formatUpdatedAt(iso);
}

/** Whole-day age as plain DE/EN text, for the cleanup “long unchanged” list. */
export function formatAgeDays(days: number, t: Translate): string {
  const years = Math.floor(days / 365);
  if (years >= 1) {
    return t({
      de: years === 1 ? "vor 1 Jahr" : `vor ${years} Jahren`,
      en: years === 1 ? "1 year ago" : `${years} years ago`,
    });
  }
  const months = Math.floor(days / 30);
  if (months >= 1) {
    return t({
      de: months === 1 ? "vor 1 Monat" : `vor ${months} Monaten`,
      en: months === 1 ? "1 month ago" : `${months} months ago`,
    });
  }
  return t({
    de: days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`,
    en: days === 1 ? "1 day ago" : `${days} days ago`,
  });
}

export function newEntryHeading(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "Neuer API-Key", en: "New API key" });
  if (kind === "sftp") return t({ de: "Neuer Server-Zugang", en: "New server login" });
  return t({ de: "Neuer Login", en: "New login" });
}
