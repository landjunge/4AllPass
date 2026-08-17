/**
 * Local demo vault store (client-only, zero-knowledge).
 *
 * Persists ONLY ciphertext to localStorage: the master envelope (VK under
 * Argon2id-derived MK), encrypted entries, and — when biometrics are set up —
 * the Device-Key Envelope and Device Envelope. Plaintext and the Vault Key
 * exist in memory only while the vault is unlocked.
 */

import {
  decryptEntry,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  resolveProfile,
  unwrapVaultKey,
  wrapVaultKey,
  zeroize,
  type DeviceKeyEnvelope,
  type EncryptedEntry,
  type KeyEnvelope,
} from "@4allpass/crypto";

const STORAGE_KEY = "4allpass.demo-vault.v1";

export interface EntryPlaintext {
  title: string;
  username: string;
  password: string;
}

interface StoredVault {
  vaultId: string;
  deviceId: string;
  name: string;
  masterEnvelope: SerializedEnvelope;
  entries: SerializedEntry[];
  biometric?: {
    credentialId: string;
    deviceKeyEnvelope: SerializedDeviceKeyEnvelope;
    deviceEnvelope: SerializedEnvelope;
  };
}

type SerializedEnvelope = ReturnType<typeof serializeEnvelope>;
type SerializedEntry = ReturnType<typeof serializeEntry>;
type SerializedDeviceKeyEnvelope = ReturnType<typeof serializeDeviceKeyEnvelope>;

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function serializeEnvelope(env: KeyEnvelope) {
  return {
    version: env.version,
    type: env.type,
    deviceId: env.deviceId,
    kdf: env.kdf
      ? { ...env.kdf, salt: toB64(env.kdf.salt) }
      : undefined,
    encryption: env.encryption,
    nonce: toB64(env.nonce),
    ciphertext: toB64(env.ciphertext),
    tag: toB64(env.tag),
  };
}

function deserializeEnvelope(raw: SerializedEnvelope): KeyEnvelope {
  const env: KeyEnvelope = {
    version: raw.version,
    type: raw.type,
    encryption: raw.encryption,
    nonce: fromB64(raw.nonce),
    ciphertext: fromB64(raw.ciphertext),
    tag: fromB64(raw.tag),
  };
  if (raw.deviceId) env.deviceId = raw.deviceId;
  if (raw.kdf) env.kdf = { ...raw.kdf, salt: fromB64(raw.kdf.salt) };
  return env;
}

function serializeEntry(entry: EncryptedEntry) {
  return {
    id: entry.id,
    schemaVersion: entry.schemaVersion,
    cryptoVersion: entry.cryptoVersion,
    nonce: toB64(entry.nonce),
    ciphertext: toB64(entry.ciphertext),
    tag: toB64(entry.tag),
  };
}

function deserializeEntry(raw: SerializedEntry): EncryptedEntry {
  return {
    id: raw.id,
    schemaVersion: raw.schemaVersion,
    cryptoVersion: raw.cryptoVersion,
    nonce: fromB64(raw.nonce),
    ciphertext: fromB64(raw.ciphertext),
    tag: fromB64(raw.tag),
  };
}

function serializeDeviceKeyEnvelope(env: DeviceKeyEnvelope) {
  return {
    version: env.version,
    vaultId: env.vaultId,
    deviceId: env.deviceId,
    credentialId: toB64(env.credentialId),
    encryption: env.encryption,
    nonce: toB64(env.nonce),
    ciphertext: toB64(env.ciphertext),
    tag: toB64(env.tag),
  };
}

function deserializeDeviceKeyEnvelope(raw: SerializedDeviceKeyEnvelope): DeviceKeyEnvelope {
  return {
    version: raw.version,
    vaultId: raw.vaultId,
    deviceId: raw.deviceId,
    credentialId: fromB64(raw.credentialId),
    encryption: raw.encryption as DeviceKeyEnvelope["encryption"],
    nonce: fromB64(raw.nonce),
    ciphertext: fromB64(raw.ciphertext),
    tag: fromB64(raw.tag),
  };
}

function load(): StoredVault | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredVault) : null;
}

function save(vault: StoredVault): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

export function vaultExists(): boolean {
  return load() !== null;
}

export function vaultMeta(): { vaultId: string; deviceId: string; name: string; hasBiometric: boolean } | null {
  const v = load();
  if (!v) return null;
  return { vaultId: v.vaultId, deviceId: v.deviceId, name: v.name, hasBiometric: !!v.biometric };
}

export function deleteVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Create the vault: VK is pure random; the Master Password only wraps it
 * (crypto-protocol.md hard invariant 1). Uses the `mobile_safe` Argon2id
 * profile so browser unlock stays responsive.
 */
export function createVault(name: string, masterPassword: string): Uint8Array {
  const profile = resolveProfile("mobile_safe");
  const salt = generateSalt();
  const vaultId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const kdf = kdfParamsFrom(profile, salt);

  const masterKey = deriveMasterKey(masterPassword, salt, profile);
  const vaultKey = generateVaultKey();
  try {
    const masterEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId,
      type: "master",
      kdf,
    });
    save({
      vaultId,
      deviceId,
      name,
      masterEnvelope: serializeEnvelope(masterEnvelope),
      entries: [],
    });
    return vaultKey;
  } finally {
    zeroize(masterKey);
  }
}

/** Master-Password unlock. Always available (webauthn-prf.md §5). */
export function unlockWithMasterPassword(masterPassword: string): Uint8Array {
  const stored = load();
  if (!stored) throw new Error("no vault");
  const envelope = deserializeEnvelope(stored.masterEnvelope);
  const masterKey = deriveMasterKeyFromEnvelope(masterPassword, envelope);
  try {
    return unwrapVaultKey(envelope, masterKey, stored.vaultId);
  } finally {
    zeroize(masterKey);
  }
}

export function storeBiometricRegistration(
  credentialId: Uint8Array,
  deviceKeyEnvelope: DeviceKeyEnvelope,
  deviceEnvelope: KeyEnvelope,
): void {
  const stored = load();
  if (!stored) throw new Error("no vault");
  stored.biometric = {
    credentialId: toB64(credentialId),
    deviceKeyEnvelope: serializeDeviceKeyEnvelope(deviceKeyEnvelope),
    deviceEnvelope: serializeEnvelope(deviceEnvelope),
  };
  save(stored);
}

export function biometricRegistration(): {
  credentialId: Uint8Array;
  deviceKeyEnvelope: DeviceKeyEnvelope;
  deviceEnvelope: KeyEnvelope;
} | null {
  const stored = load();
  if (!stored?.biometric) return null;
  return {
    credentialId: fromB64(stored.biometric.credentialId),
    deviceKeyEnvelope: deserializeDeviceKeyEnvelope(stored.biometric.deviceKeyEnvelope),
    deviceEnvelope: deserializeEnvelope(stored.biometric.deviceEnvelope),
  };
}

export function listEntries(vaultKey: Uint8Array): Array<{ id: string } & EntryPlaintext> {
  const stored = load();
  if (!stored) return [];
  return stored.entries.map((raw) => {
    const entry = deserializeEntry(raw);
    const plaintext = decryptEntry(entry, vaultKey, stored.vaultId);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as EntryPlaintext;
    zeroize(plaintext);
    return { id: entry.id, ...parsed };
  });
}

export function addEntry(vaultKey: Uint8Array, plaintext: EntryPlaintext): void {
  const stored = load();
  if (!stored) throw new Error("no vault");
  const entry = encryptEntry({
    vaultKey,
    vaultId: stored.vaultId,
    entryId: crypto.randomUUID(),
    plaintext: new TextEncoder().encode(JSON.stringify(plaintext)),
  });
  stored.entries.push(serializeEntry(entry));
  save(stored);
}
