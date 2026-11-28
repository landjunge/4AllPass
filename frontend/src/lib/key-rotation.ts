/**
 * "Schlüsselrotation begleiten" (issue #279 Punkt 5).
 *
 * Deliberately small, as the issue scopes it: accompany a manual renewal at
 * the provider — never an automated rotation API, never a network call from
 * this module. It reuses the #278 "create a new key" clipboard-capture flow
 * (`useKeyCreateCapture`, `provider-key-create.ts`) verbatim for an
 * *existing* entry instead of a new draft: same provider allow-list, same
 * bounded clipboard capture, same "nothing persists until Save" rule. The
 * only new pieces are here — picking the right provider id for an existing
 * entry's free-text `provider` field, and recognizing when a "new" key is
 * actually just the old one again.
 *
 * Rotation never mints a new entry id and never bumps `vaultKeyVersion`
 * (that counter is the whole-vault crypto key generation from the recovery
 * flow — unrelated to a single provider key being renewed). Saving the
 * rotated draft through the existing Save button both updates this one
 * entry in place and writes a new vault revision, which is what already
 * keeps the previous (pre-rotation) key value reachable under "Frühere
 * Stände" (`VaultHistoryPanel`) — no separate history mechanism needed.
 */
import { isCheckableProviderId, suggestCheckableProvider, type CheckableProviderId } from "./provider-key-check.ts";
import type { KeyCreateProviderId } from "./provider-key-create.ts";
import type { VaultEntry } from "../types/vault.ts";

// `CheckableProviderId` (#277) and `KeyCreateProviderId` (#278) are the same
// three literal ids today, and adding a provider to one always means adding
// it to the other (see provider-key-create.ts's module doc). This is the one
// place that leans on that equivalence, so a future divergence breaks here
// instead of silently mismatching copy.
function assertSharedProviderIds(id: CheckableProviderId): KeyCreateProviderId {
  return id;
}

/**
 * Which provider, if any, the automated "open the provider's page + capture
 * from clipboard" rotation flow can offer for this entry — an exact match
 * against the entry's own `provider` text, never a guess. `null` means no
 * supported provider: the rotation panel still displays, but only as a
 * manual checklist (no page-open button, no clipboard capture).
 */
export function rotatableProviderFor(providerText: string): KeyCreateProviderId | null {
  const id = suggestCheckableProvider(providerText);
  return id ? assertSharedProviderIds(id) : null;
}

export function isRotatableProviderId(value: string): value is KeyCreateProviderId {
  return isCheckableProviderId(value);
}

/**
 * True when a just-captured value is byte-for-byte the key already stored
 * on this entry — almost certainly a stale clipboard, not an actual new key
 * from the provider. Surfaced as a notice, never silently swallowed and
 * never silently applied as if it were a real rotation.
 */
export function isUnchangedKey(entry: VaultEntry, capturedPassword: string): boolean {
  return entry.password !== "" && entry.password === capturedPassword;
}
