/**
 * Local, read-only API-key validity checking (issue #277).
 *
 * The actual provider network call happens in Rust (`provider_key_check.rs`,
 * `check_provider_keys` Tauri command) — this module is pure, key-free logic:
 * which providers can be checked at all, a non-guessing pre-fill suggestion,
 * and display copy for a result. Nothing here ever receives, stores, or
 * logs a key value.
 */
import type { Translate } from "../types/vault.ts";

/** Exactly the providers `packages/providers` already lists with an "api"
 * credential kind in this codebase, and that have one documented, free,
 * read-only endpoint this module can tell "valid" from "not valid" for
 * without guessing. Cloudflare has that credential kind too but two
 * incompatible key shapes (scoped Token vs. legacy Global Key + email) and
 * no single endpoint that works for both — left out on purpose, not an
 * oversight. Adding a provider here always means adding its adapter in
 * `provider_key_check.rs` first. */
export const CHECKABLE_PROVIDERS = [
  { id: "github", name: "GitHub" },
  { id: "openai", name: "OpenAI" },
  { id: "stripe", name: "Stripe" },
] as const;

export type CheckableProviderId = (typeof CHECKABLE_PROVIDERS)[number]["id"];

export function isCheckableProviderId(value: string): value is CheckableProviderId {
  return CHECKABLE_PROVIDERS.some((provider) => provider.id === value);
}

/**
 * Convenience pre-fill for the check dialog's provider picker — an exact
 * match against the provider id or display name, e.g. "GitHub" or "github".
 * Never a key-prefix guess: this only pre-selects a dropdown option the
 * user still sees and can change before the explicit "Prüfen"/"Check" click.
 */
export function suggestCheckableProvider(providerText: string): CheckableProviderId | null {
  const normalized = providerText.trim().toLowerCase();
  if (!normalized) return null;
  const hit = CHECKABLE_PROVIDERS.find(
    (provider) => provider.id === normalized || provider.name.toLowerCase() === normalized,
  );
  return hit ? hit.id : null;
}

/** Mirrors `KeyCheckStatus` in `src-tauri/src/provider_key_check.rs`. */
export type ProviderKeyCheckStatus =
  | "valid"
  | "invalid"
  | "insufficient_permission"
  | "quota_exceeded"
  | "unreachable"
  | "not_checkable";

export interface ProviderKeyCheckOutcome {
  id: string;
  status: ProviderKeyCheckStatus;
  scopeHint: string | null;
}

/** A displayed result: the outcome plus the moment it was taken and the
 * provider id it was actually checked against. A snapshot, never a standing
 * guarantee — callers re-check explicitly to refresh it. `providerId` is
 * required so a caller can refuse to show a result next to a provider it
 * was never run for (e.g. the dropdown changed after the request went out,
 * or a late/async reply arrives after the pick moved on). */
export interface ProviderKeyCheckRecord extends ProviderKeyCheckOutcome {
  providerId: CheckableProviderId;
  checkedAt: string;
}

/**
 * Guards the UI bug in issue #277 finding 2: a stored result was indexed
 * only by vault-entry id, never by the provider it was actually checked
 * against, so switching the provider dropdown after a check (or a reply
 * arriving late, after the dropdown had already moved on) left an old
 * result like "Valid" visibly attached to a provider that was never
 * checked. This is the single place that decides whether a stored result
 * may still be shown: only when its own `providerId` still matches the
 * currently selected one.
 */
export function currentResultFor<Result extends { providerId: CheckableProviderId }>(
  stored: Result | undefined,
  selectedProviderId: CheckableProviderId | "",
): Result | undefined {
  if (!stored || selectedProviderId === "") return undefined;
  return stored.providerId === selectedProviderId ? stored : undefined;
}

export function statusLabel(status: ProviderKeyCheckStatus, t: Translate): string {
  switch (status) {
    case "valid":
      return t({ de: "Gültig", en: "Valid" });
    case "invalid":
      return t({ de: "Ungültig oder widerrufen", en: "Invalid or revoked" });
    case "insufficient_permission":
      return t({ de: "Berechtigung unzureichend", en: "Insufficient permission" });
    case "quota_exceeded":
      return t({ de: "Quota/Billing erschöpft", en: "Quota/billing exhausted" });
    case "unreachable":
      return t({ de: "Anbieter nicht erreichbar", en: "Provider unreachable" });
    case "not_checkable":
      return t({ de: "Nicht prüfbar", en: "Not checkable" });
    default:
      return t({ de: "Nicht prüfbar", en: "Not checkable" });
  }
}

export function statusHint(status: ProviderKeyCheckStatus, t: Translate): string {
  switch (status) {
    case "unreachable":
      return t({
        de: "Netzwerk- oder Providerfehler. Sagt nichts über den Schlüssel aus.",
        en: "Network or provider error. Says nothing about the key.",
      });
    case "quota_exceeded":
      return t({
        de: "429/Kontingent. Kein Beweis, dass der Schlüssel ungültig ist.",
        en: "429/quota. Not proof the key is invalid.",
      });
    case "insufficient_permission":
      return t({
        de: "403 oder fehlender Umfang. Kein Beweis, dass der Schlüssel ungültig ist.",
        en: "403 or missing scope. Not proof the key is invalid.",
      });
    case "not_checkable":
      return t({
        de: "Kein unterstützter Anbieter, kein Schlüssel, oder unerwartete Antwort.",
        en: "Unsupported provider, no key, or an unexpected response.",
      });
    default:
      return "";
  }
}
