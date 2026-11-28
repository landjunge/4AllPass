/**
 * "Create a new API key" flow (issue #278): pick a provider, open its real,
 * official key-creation page in the external browser, then capture the new
 * key from the clipboard for a short, user-started, bounded window — never
 * a permanent background watcher.
 *
 * Pure logic only. Opening the page actually happens via the Tauri command
 * `open_provider_key_page` (`src-tauri/src/provider_key_create.rs`), which
 * maps a provider id to one of a small fixed allow-list of official URLs —
 * never a caller-supplied address. This module mirrors that same allow-list
 * so the UI can label buttons and never offers a provider the Rust side
 * does not also recognize.
 *
 * Deliberately the same three ids `provider-key-check.ts` (#277) already
 * covers — those are exactly the providers this codebase's `@4allpass/providers`
 * registry lists with an "api" credential kind
 * (`frontend/src/lib/providers.ts`). Adding a provider here always means
 * adding its official URL in `provider_key_create.rs` too.
 */
import { detectCredential } from "./detect.ts";

export const KEY_CREATE_PROVIDERS = [
  { id: "github", name: "GitHub" },
  { id: "openai", name: "OpenAI" },
  { id: "stripe", name: "Stripe" },
] as const;

export type KeyCreateProviderId = (typeof KEY_CREATE_PROVIDERS)[number]["id"];

export function isKeyCreateProviderId(value: string): value is KeyCreateProviderId {
  return KEY_CREATE_PROVIDERS.some((provider) => provider.id === value);
}

export function keyCreateProviderName(id: KeyCreateProviderId): string {
  return KEY_CREATE_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
}

/** One user-started capture phase lasts this long, then switches itself off. */
export const CAPTURE_TIMEOUT_MS = 90_000;

/** How often the capture phase re-reads the clipboard while it is active. */
export const CAPTURE_POLL_MS = 1_000;

/**
 * Does `text` look like a key for exactly `providerId`? Reuses the same
 * provider-specific shape patterns `detectCredential` already uses for the
 * manual "paste and detect" flow (`lib/detect.ts`) — no separate guessing
 * logic, and no provider accepts another provider's shape. Returns the
 * detected fields on a match so the caller can prefill a draft without
 * re-deriving them; `null` on anything that does not plausibly look like
 * this provider's key, including empty text or a provider mismatch.
 */
export function detectProviderKey(
  providerId: KeyCreateProviderId,
  text: string,
): ReturnType<typeof detectCredential> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const detected = detectCredential(trimmed);
  if (!detected || detected.kind !== "api") return null;
  const expectedName = keyCreateProviderName(providerId).toLowerCase();
  if (detected.provider.toLowerCase() !== expectedName) return null;
  return detected;
}
