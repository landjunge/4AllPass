/**
 * The locally pinned `(vaultId, revision, vaultKeyVersion)` of vault-revision.md §3.
 *
 * AES-GCM proves a snapshot was not modified, not that it is the latest one.
 * The pin lives outside the server's control so a replayed older snapshot is
 * refused instead of silently unlocked.
 */
import type { VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

export function loadPin(vaultId: string): VaultRevision | null {
  const raw = localStorage.getItem(PIN_PREFIX + vaultId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VaultRevision;
    if (
      parsed.vaultId === vaultId &&
      Number.isInteger(parsed.revision) &&
      Number.isInteger(parsed.vaultKeyVersion)
    ) {
      return { ...parsed, cryptoProtocolVersion: 1 };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePin(pin: VaultRevision): void {
  localStorage.setItem(PIN_PREFIX + pin.vaultId, JSON.stringify(pin));
}
