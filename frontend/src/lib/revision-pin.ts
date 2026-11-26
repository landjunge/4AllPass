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

/**
 * Protocol expectation options for a version that may be unknown. Storage uses
 * `exactOptionalPropertyTypes`, so an unknown version must stay an absent
 * option (which the crypto API reads as v1) rather than an explicit undefined.
 */
export function protocolExpectation(cryptoProtocolVersion?: number): SnapshotProtocolOptions {
  return cryptoProtocolVersion === undefined ? {} : { cryptoProtocolVersion };
}

/** The protocol this client already accepted for the vault, as options. */
export function pinnedExpectation(vaultId: string): SnapshotProtocolOptions {
  return protocolExpectation(pinnedProtocolVersion(vaultId));
}

/**
 * Which crypto protocol this client already accepted for the vault, or
 * `undefined` when no pin exists yet.
 *
 * Reading the stored field raw is deliberate: `loadPin` validates the stored
 * version against the caller's expectation, so the expectation cannot be derived
 * from `loadPin` itself. Durable local state written after a verified manifest
 * may anchor it — a server header may never do that (see `snapshot-protocol.ts`).
 */
export function pinnedProtocolVersion(vaultId: string): number | undefined {
  const raw = localStorage.getItem(PIN_PREFIX + vaultId);
  if (raw === null) return undefined;
  let parsed: Partial<StoredPin> | null;
  try {
    parsed = JSON.parse(raw) as Partial<StoredPin> | null;
  } catch {
    return undefined;
  }
  return parsed && typeof parsed === "object" ? parsed.cryptoProtocolVersion : undefined;
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
