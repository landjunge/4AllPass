/**
 * Local revision pin for the extension. Same contract as the PWA pin:
 * AES-GCM proves authenticity, not freshness. The pin lives off the server.
 */
import { base64ToBytes, bytesToBase64 } from "@4allpass/crypto";
import type { VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

export interface PinStore {
  load(vaultId: string): Promise<VaultRevision | null>;
  save(pin: VaultRevision): Promise<void>;
}

interface StoredPin {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: number;
  manifestDigest?: string;
}

function parsePin(raw: unknown, vaultId: string): VaultRevision | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as StoredPin;
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
    cryptoProtocolVersion: parsed.cryptoProtocolVersion ?? 1,
  };
  if (typeof parsed.manifestDigest === "string" && parsed.manifestDigest.length > 0) {
    pin.manifestDigest = base64ToBytes(parsed.manifestDigest);
  }
  return pin;
}

function serializePin(pin: VaultRevision): StoredPin {
  const stored: StoredPin = {
    vaultId: pin.vaultId,
    revision: pin.revision,
    vaultKeyVersion: pin.vaultKeyVersion,
    cryptoProtocolVersion: 1,
  };
  if (pin.manifestDigest) {
    stored.manifestDigest = bytesToBase64(pin.manifestDigest);
  }
  return stored;
}

export function memoryPinStore(): PinStore {
  const pins = new Map<string, StoredPin>();
  return {
    async load(vaultId) {
      return parsePin(pins.get(PIN_PREFIX + vaultId), vaultId);
    },
    async save(pin) {
      pins.set(PIN_PREFIX + pin.vaultId, serializePin(pin));
    },
  };
}

export function chromePinStore(): PinStore {
  return {
    async load(vaultId) {
      const key = PIN_PREFIX + vaultId;
      const bag = await chrome.storage.local.get(key);
      return parsePin(bag[key], vaultId);
    },
    async save(pin) {
      const key = PIN_PREFIX + pin.vaultId;
      await chrome.storage.local.set({ [key]: serializePin(pin) });
    },
  };
}

export function defaultPinStore(): PinStore {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      return chromePinStore();
    }
  } catch {
    // Node tests / no extension API
  }
  return memoryPinStore();
}
