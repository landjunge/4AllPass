import { DETECT_HIGH_MIN, type CredentialKind, type SetupSuggestion } from "@4allpass/providers";
import type { FillReason } from "./fill.ts";
import { hostnameOf } from "./match.ts";

/**
 * API keys are high-value and a page only has to choose a field name to look
 * interesting. One threshold for every API-key fill, always together with a
 * provider-domain hit from `detectSetup` (field name alone is 0.45).
 */
export const API_FILL_MIN_CONFIDENCE = DETECT_HIGH_MIN;

/** The tab + exact URL + host where the popup showed a suggestion. */
export interface SuggestionBinding {
  tabId: number;
  url: string;
  host: string;
  providerId: string | null;
  credentialKind: CredentialKind | null;
  matchedField: string | null;
}

const CREDENTIAL_KINDS: CredentialKind[] = [
  "web-login",
  "api",
  "oauth",
  "smtp",
  "ftp",
  "domain",
];

/** Bind a shown suggestion to the tab/URL that produced it. */
export function createSuggestionBinding(
  tab: { id?: number; url?: string } | undefined,
  suggestion: SetupSuggestion,
): SuggestionBinding | null {
  if (tab?.id === undefined || !tab.url) return null;
  const host = hostnameOf(tab.url);
  if (!host) return null;
  return {
    tabId: tab.id,
    url: tab.url,
    host,
    providerId: suggestion.providerId,
    credentialKind: suggestion.credentialKind,
    matchedField: suggestion.matchedField,
  };
}

/**
 * Runtime validation for a binding that came back through extension
 * messaging. Malformed or inconsistent values are rejected, not repaired.
 */
export function parseSuggestionBinding(value: unknown): SuggestionBinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const tabId = record.tabId;
  const url = record.url;
  const host = record.host;
  const providerId = record.providerId;
  const credentialKind = record.credentialKind;
  const matchedField = record.matchedField;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) return null;
  if (typeof url !== "string" || typeof host !== "string" || !host) return null;
  if (hostnameOf(url) !== host) return null;
  if (providerId !== null && typeof providerId !== "string") return null;
  if (
    credentialKind !== null &&
    (typeof credentialKind !== "string" || !CREDENTIAL_KINDS.includes(credentialKind as CredentialKind))
  ) {
    return null;
  }
  if (matchedField !== null && typeof matchedField !== "string") return null;
  return {
    tabId,
    url,
    host,
    providerId: providerId as string | null,
    credentialKind: credentialKind as CredentialKind | null,
    matchedField: matchedField as string | null,
  };
}

/** Same tab, same exact URL (so same host) and the tab is still active. */
export function suggestionBindingStillHolds(
  binding: SuggestionBinding,
  liveTab: { id?: number; url?: string } | undefined,
  activeTab: { id?: number } | undefined,
): boolean {
  if (!liveTab || liveTab.id !== binding.tabId) return false;
  if (!activeTab || activeTab.id !== binding.tabId) return false;
  if (liveTab.url !== binding.url) return false;
  return hostnameOf(liveTab.url) === binding.host;
}

/**
 * API-key fill needs the page itself to resolve to the same provider at high
 * confidence. `fieldNames: ["openai_api_key"]` on evil.example never passes.
 */
export function apiFillAllowed(
  suggestion: SetupSuggestion,
): suggestion is SetupSuggestion & {
  providerId: string;
  credentialKind: "api";
  matchedField: string;
  domainHit: true;
} {
  return Boolean(
    suggestion.providerId &&
      suggestion.credentialKind === "api" &&
      suggestion.matchedField &&
      suggestion.domainHit &&
      suggestion.confidence >= API_FILL_MIN_CONFIDENCE,
  );
}

/** Fresh detection must still be the provider/field the popup showed. */
export function suggestionMatchesBinding(
  binding: SuggestionBinding,
  suggestion: SetupSuggestion,
): boolean {
  if (suggestion.providerId !== binding.providerId) return false;
  if (suggestion.credentialKind !== binding.credentialKind) return false;
  if (binding.matchedField !== null && suggestion.matchedField !== binding.matchedField) return false;
  return true;
}

/** Fail closed with a fill reason, or `null` when the acceptance may proceed. */
export function suggestionAcceptanceFailure(
  binding: SuggestionBinding | null | undefined,
  suggestion: SetupSuggestion,
): FillReason | null {
  if (!binding) return "no-match";
  if (!suggestionMatchesBinding(binding, suggestion)) return "no-match";
  if (binding.credentialKind === "api" && !apiFillAllowed(suggestion)) return "low-confidence";
  return null;
}
