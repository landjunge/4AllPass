/**
 * The locally pinned `(vaultId, revision, vaultKeyVersion, manifestDigest)`
 * of vault-revision.md §3.
 *
 * AES-GCM proves a snapshot was not modified, not that it is the latest one.
 * The pin lives outside the server's control so a replayed older snapshot is
 * refused instead of silently unlocked. The digest is taken from a verified
 * sealed manifest — never from a number the server merely asserted.
 */
import { bytesToHex, hexToBytes } from "@4allpass/crypto";
import type { VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

interface StoredPin {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
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
      return {
        vaultId: parsed.vaultId,
        revision: parsed.revision,
        vaultKeyVersion: parsed.vaultKeyVersion,
        cryptoProtocolVersion: 1,
        manifestDigest:
          typeof parsed.manifestDigest === "string" ? hexToBytes(parsed.manifestDigest) : undefined,
      };
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
    cryptoProtocolVersion: pin.cryptoProtocolVersion,
  };
  if (pin.manifestDigest) {
    stored.manifestDigest = bytesToHex(pin.manifestDigest);
  }
  localStorage.setItem(PIN_PREFIX + pin.vaultId, JSON.stringify(stored));
}
