/**
 * The locally pinned `(vaultId, revision, vaultKeyVersion)` of vault-revision.md §3.
 *
 * AES-GCM proves a snapshot was not modified, not that it is the latest one.
 * The pin lives outside the server's control so a replayed older snapshot is
 * refused instead of silently unlocked. When a sealed manifest was verified,
 * the pin also stores its digest so the same revision cannot fork.
 */
import { base64ToBytes, bytesToBase64 } from "@4allpass/crypto";
import type { VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

interface StoredPin {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: number;
  manifestDigest?: string;
}

export function loadPin(vaultId: string): VaultRevision | null {
  const raw = localStorage.getItem(PIN_PREFIX + vaultId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPin;
    if (
      parsed.vaultId === vaultId &&
      Number.isInteger(parsed.revision) &&
      Number.isInteger(parsed.vaultKeyVersion)
    ) {
      const pin: VaultRevision = {
        vaultId: parsed.vaultId,
        revision: parsed.revision,
        vaultKeyVersion: parsed.vaultKeyVersion,
        cryptoProtocolVersion: 1,
      };
      if (typeof parsed.manifestDigest === "string" && parsed.manifestDigest.length > 0) {
        pin.manifestDigest = base64ToBytes(parsed.manifestDigest);
      }
      return pin;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePin(pin: VaultRevision): void {
  const stored: StoredPin = {
    vaultId: pin.vaultId,
    revision: pin.revision,
    vaultKeyVersion: pin.vaultKeyVersion,
    cryptoProtocolVersion: 1,
  };
  if (pin.manifestDigest) {
    stored.manifestDigest = bytesToBase64(pin.manifestDigest);
  }
  localStorage.setItem(PIN_PREFIX + pin.vaultId, JSON.stringify(stored));
}
