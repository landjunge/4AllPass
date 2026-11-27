/**
 * The locally pinned `(vaultId, revision, vaultKeyVersion)` of vault-revision.md §3.
 *
 * AES-GCM proves a snapshot was not modified, not that it is the latest one.
 * The pin lives outside the server's control so a replayed older snapshot is
 * refused instead of silently unlocked. When a sealed manifest was verified,
 * the pin also stores its digest so the same revision cannot fork.
 */
import { ProtocolError, assertFreshSnapshot, base64ToBytes, bytesToBase64 } from "@4allpass/crypto";
import type { SnapshotProtocolOptions, VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

interface StoredPin {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: number;
  manifestDigest?: string;
}

/** Capture caller-owned accessors once; validation stays in the crypto API. */
function captureExpectation(options: SnapshotProtocolOptions): SnapshotProtocolOptions {
  const cryptoProtocolVersion = options.cryptoProtocolVersion;
  return cryptoProtocolVersion === undefined ? {} : { cryptoProtocolVersion };
}

export function loadPin(vaultId: string, options: SnapshotProtocolOptions = {}): VaultRevision | null {
  const expectation = captureExpectation(options);
  const raw = localStorage.getItem(PIN_PREFIX + vaultId);
  if (raw === null) return null;
  let parsed: StoredPin;
  try {
    parsed = JSON.parse(raw) as StoredPin;
  } catch (cause) {
    throw new ProtocolError("stored revision pin is not valid JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.vaultId !== vaultId) {
    throw new ProtocolError("stored revision pin does not identify the requested vault");
  }
  const pin: VaultRevision = {
    vaultId: parsed.vaultId,
    revision: parsed.revision,
    vaultKeyVersion: parsed.vaultKeyVersion,
    // Only historical omission means v1. Explicit null/invalid values must
    // reach validation, never become a default or an absent pin.
    cryptoProtocolVersion: parsed.cryptoProtocolVersion === undefined ? 1 : parsed.cryptoProtocolVersion,
  };
  if (parsed.manifestDigest !== undefined) {
    if (typeof parsed.manifestDigest !== "string") {
      throw new ProtocolError("stored manifest digest must be base64");
    }
    pin.manifestDigest = base64ToBytes(parsed.manifestDigest);
  }
  // Shares the crypto library's finite version, bounds and digest checks.
  assertFreshSnapshot(null, pin, expectation);
  return pin;
}

export function savePin(pin: VaultRevision, options: SnapshotProtocolOptions = {}): void {
  const expectation = captureExpectation(options);
  // Persist the same plain fields/bytes that were checked, even if the caller
  // supplied getters or storage callbacks can touch its input object.
  const incoming: VaultRevision = {
    vaultId: pin.vaultId,
    revision: pin.revision,
    vaultKeyVersion: pin.vaultKeyVersion,
    cryptoProtocolVersion: pin.cryptoProtocolVersion,
  };
  const digest = pin.manifestDigest;
  if (digest !== undefined) {
    incoming.manifestDigest = digest instanceof Uint8Array ? Uint8Array.from(digest) : digest;
  }
  assertFreshSnapshot(null, incoming, expectation);
  // Validate existing storage before replacing it: an unreadable or different
  // protocol pin is not permission to reset trust. No migration is done here.
  const existing = loadPin(incoming.vaultId, expectation);
  assertFreshSnapshot(existing, incoming, expectation);
  const stored: StoredPin = {
    vaultId: incoming.vaultId,
    revision: incoming.revision,
    vaultKeyVersion: incoming.vaultKeyVersion,
    cryptoProtocolVersion: incoming.cryptoProtocolVersion,
  };
  if (incoming.manifestDigest) {
    stored.manifestDigest = bytesToBase64(incoming.manifestDigest);
  }
  localStorage.setItem(PIN_PREFIX + incoming.vaultId, JSON.stringify(stored));
}
