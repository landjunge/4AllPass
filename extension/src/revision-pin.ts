/**
 * The extension's copy of the revision pin (vault-revision.md §3).
 *
 * The extension reads the same server-controlled snapshot the PWA does, so it
 * needs the same freshness state. Without a pin, AES-GCM proves only that a
 * snapshot was not modified — a server can replay yesterday's snapshot and the
 * extension will happily fill yesterday's password into a login form.
 *
 * The interface is injectable so that `unlockVault` stays testable outside a
 * browser; the `ext.storage.local` implementation lives in `pin-store.ts`.
 */
import { base64ToBytes, bytesToBase64 } from "@4allpass/crypto";
import type { VaultRevision } from "@4allpass/crypto";

export const PIN_PREFIX = "4allpass.pin.";

export interface StoredPin {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: number;
  manifestDigest?: string;
}

export interface PinStore {
  load(vaultId: string): Promise<VaultRevision | null>;
  save(pin: VaultRevision): Promise<void>;
}

/** Shape-check a stored record: extension storage is not a trusted input. */
export function pinFromStored(vaultId: string, value: unknown): VaultRevision | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as StoredPin;
  if (
    parsed.vaultId !== vaultId ||
    !Number.isInteger(parsed.revision) ||
    !Number.isInteger(parsed.vaultKeyVersion)
  ) {
    return null;
  }
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

export function pinToStored(pin: VaultRevision): StoredPin {
  const stored: StoredPin = {
    vaultId: pin.vaultId,
    revision: pin.revision,
    vaultKeyVersion: pin.vaultKeyVersion,
    cryptoProtocolVersion: 1,
  };
  if (pin.manifestDigest) stored.manifestDigest = bytesToBase64(pin.manifestDigest);
  return stored;
}

export function memoryPinStore(initial: readonly VaultRevision[] = []): PinStore {
  const pins = new Map<string, StoredPin>();
  for (const pin of initial) pins.set(pin.vaultId, pinToStored(pin));
  return {
    async load(vaultId) {
      return pinFromStored(vaultId, pins.get(vaultId));
    },
    async save(pin) {
      pins.set(pin.vaultId, pinToStored(pin));
    },
  };
}
