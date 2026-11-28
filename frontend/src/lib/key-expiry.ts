/**
 * Local, read-only expiry display logic (issue #279).
 *
 * Mirrors `KeyExpiry` in `src-tauri/src/provider_key_check.rs`: a key's
 * expiry is either `unknown` (the provider does not report a real one, or
 * this check did not read one) or `known` with an ISO-8601 instant the
 * provider itself sent. This module never invents a date — the "expired" /
 * "expires in N days" reminder below is a pure, local computation from an
 * already-known real date, not a new source of truth. No backend cron, no
 * push notification: the reminder exists only while this panel is open.
 */
import type { Translate } from "../types/vault.ts";

export type ProviderKeyExpiry = { kind: "unknown" } | { kind: "known"; expiresAt: string };

export type ExpiryReminderTone = "unknown" | "ok" | "warn" | "expired";

export interface ExpiryReminder {
  tone: ExpiryReminderTone;
  label: string;
}

/** Visual "heads up" window — still a real, known date; only the tone
 * changes, never the reported date itself. */
const WARN_WITHIN_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function describeExpiry(expiry: ProviderKeyExpiry, t: Translate, now: Date = new Date()): ExpiryReminder {
  const unknown: ExpiryReminder = {
    tone: "unknown",
    label: t({ de: "Ablaufdatum unbekannt", en: "Expiry unknown" }),
  };
  if (expiry.kind === "unknown") return unknown;

  const expiresAt = new Date(expiry.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return unknown;

  const dateLabel = expiresAt.toLocaleDateString();
  const msRemaining = expiresAt.getTime() - now.getTime();

  if (msRemaining < 0) {
    return { tone: "expired", label: t({ de: `Abgelaufen am ${dateLabel}`, en: `Expired on ${dateLabel}` }) };
  }
  // Still in the future, but the same calendar day as `now`: say "today",
  // never derived from the rounded day count (that rounds a few hours in
  // the past up to "today" too, which is the bug this guards against).
  if (expiresAt.toDateString() === now.toDateString()) {
    return { tone: "expired", label: t({ de: "Läuft heute ab", en: "Expires today" }) };
  }
  const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);
  if (daysRemaining <= WARN_WITHIN_DAYS) {
    return {
      tone: "warn",
      label: t({
        de: `Läuft in ${daysRemaining} Tagen ab (${dateLabel})`,
        en: `Expires in ${daysRemaining} days (${dateLabel})`,
      }),
    };
  }
  return { tone: "ok", label: t({ de: `Läuft ab am ${dateLabel}`, en: `Expires on ${dateLabel}` }) };
}
