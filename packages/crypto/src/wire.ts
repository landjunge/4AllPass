/**
 * JSON wire format for everything the server is allowed to store.
 *
 * Binary fields are standard base64. Decoding is strict and structural:
 * envelopes arrive from a server that is not trusted (see threat-model.md),
 * so lengths, versions, and the type/field combinations are validated here
 * instead of somewhere in the UI.
 */
import {
  CRYPTO_PROTOCOL_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
  TAG_BYTES,
  VERSION_MAX,
} from "./constants.ts";
import { base64ToBytes, bytesToBase64 } from "./encoding/base64.ts";
import { ProtocolError } from "./errors.ts";
import type {
  Argon2idParams,
  DeviceKeyEnvelope,
  EncryptedEntry,
  EnvelopeType,
  KdfParams,
  KeyEnvelope,
  SealedManifest,
  VaultSnapshot,
} from "./types.ts";

export interface WireKdfParams {
  algorithm: "argon2id";
  version: number;
  memory: number;
  iterations: number;
  parallelism: number;
  hashLen: number;
  salt: string;
}

export interface WireKeyEnvelope {
  version: number;
  type: EnvelopeType;
  vaultKeyVersion: number;
  encryption: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  tag: string;
  deviceId?: string;
  deviceKeyVersion?: number;
  kdf?: WireKdfParams;
}

export interface WireDeviceKeyEnvelope {
  version: number;
  vaultId: string;
  deviceId: string;
  credentialId: string;
  deviceKeyVersion: number;
  encryption: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface WireEncryptedEntry {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  vaultKeyVersion: number;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface WireVaultSnapshot {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
  manifest: WireSealedManifest;
  envelopes: WireKeyEnvelope[];
  entries: WireEncryptedEntry[];
}

export interface WireSealedManifest {
  version: number;
  encryption: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  tag: string;
}

const ENVELOPE_TYPES: readonly EnvelopeType[] = ["master", "device", "recovery"];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** An optional field may be omitted or explicitly null; both mean "absent". */
function optional(source: Record<string, unknown>, key: string): unknown {
  const value = source[key];
  return value === null ? undefined : value;
}

function requireString(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requireInt(source: Record<string, unknown>, key: string, label: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProtocolError(`${label}.${key} must be a non-negative integer`);
  }
  return value;
}

function requireBytes(
  source: Record<string, unknown>,
  key: string,
  label: string,
  exactLength?: number,
): Uint8Array {
  const bytes = base64ToBytes(requireString(source, key, label));
  if (exactLength !== undefined && bytes.length !== exactLength) {
    throw new ProtocolError(`${label}.${key} must be ${exactLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function requireVersion(source: Record<string, unknown>, key: string, label: string): number {
  const version = requireInt(source, key, label);
  if (version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`${label}.${key} ${version} is not supported (expected ${CRYPTO_PROTOCOL_VERSION})`);
  }
  return version;
}

/**
 * Key generations are 1-based: 0 is reserved for "not applicable" inside AAD.
 * The upper bound is the uint32 the AAD encodes, so a generation the core would
 * refuse is refused here instead of being handed on as "validated".
 */
function requireGeneration(source: Record<string, unknown>, key: string, label: string): number {
  const value = requireInt(source, key, label);
  if (value < 1 || value > VERSION_MAX) {
    throw new ProtocolError(`${label}.${key} must be in [1, ${VERSION_MAX}], got ${value}`);
  }
  return value;
}

function requireGcm(source: Record<string, unknown>, label: string): void {
  if (source.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`${label}.encryption must be AES-256-GCM`);
  }
}

export function encodeKdfParams(kdf: KdfParams): WireKdfParams {
  return {
    algorithm: kdf.algorithm,
    version: kdf.version,
    memory: kdf.memory,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLen: kdf.hashLen,
    salt: bytesToBase64(kdf.salt),
  };
}

export function decodeKdfParams(value: unknown): KdfParams {
  const source = asRecord(value, "kdf");
  if (source.algorithm !== "argon2id") {
    throw new ProtocolError("kdf.algorithm must be argon2id");
  }
  const version = requireInt(source, "version", "kdf");
  if (version !== 0x13) {
    throw new ProtocolError(`kdf.version must be 0x13, got ${version}`);
  }
  const hashLen = requireInt(source, "hashLen", "kdf");
  if (hashLen !== KEY_BYTES) {
    throw new ProtocolError(`kdf.hashLen must be ${KEY_BYTES}`);
  }
  const salt = requireBytes(source, "salt", "kdf");
  if (salt.length !== SALT_BYTES_MIN && salt.length !== SALT_BYTES_MAX) {
    throw new ProtocolError(`kdf.salt must be ${SALT_BYTES_MIN} or ${SALT_BYTES_MAX} bytes`);
  }
  const params: Argon2idParams = {
    algorithm: "argon2id",
    version: 0x13,
    memory: requireInt(source, "memory", "kdf"),
    iterations: requireInt(source, "iterations", "kdf"),
    parallelism: requireInt(source, "parallelism", "kdf"),
    hashLen: KEY_BYTES,
  };
  if (params.memory < 8 || params.iterations < 1 || params.parallelism < 1) {
    throw new ProtocolError("kdf parameters are out of range");
  }
  return { ...params, salt };
}

export function encodeKeyEnvelope(envelope: KeyEnvelope): WireKeyEnvelope {
  const wire: WireKeyEnvelope = {
    version: envelope.version,
    type: envelope.type,
    vaultKeyVersion: envelope.vaultKeyVersion,
    encryption: envelope.encryption,
    nonce: bytesToBase64(envelope.nonce),
    ciphertext: bytesToBase64(envelope.ciphertext),
    tag: bytesToBase64(envelope.tag),
  };
  if (envelope.deviceId) wire.deviceId = envelope.deviceId;
  if (envelope.deviceKeyVersion !== undefined) wire.deviceKeyVersion = envelope.deviceKeyVersion;
  if (envelope.kdf) wire.kdf = encodeKdfParams(envelope.kdf);
  return wire;
}

export function decodeKeyEnvelope(value: unknown): KeyEnvelope {
  const source = asRecord(value, "envelope");
  requireVersion(source, "version", "envelope");
  requireGcm(source, "envelope");
  const type = source.type;
  if (typeof type !== "string" || !ENVELOPE_TYPES.includes(type as EnvelopeType)) {
    throw new ProtocolError(`envelope.type must be one of ${ENVELOPE_TYPES.join(", ")}`);
  }
  const envelope: KeyEnvelope = {
    version: CRYPTO_PROTOCOL_VERSION,
    type: type as EnvelopeType,
    vaultKeyVersion: requireGeneration(source, "vaultKeyVersion", "envelope"),
    encryption: "AES-256-GCM",
    nonce: requireBytes(source, "nonce", "envelope", NONCE_BYTES),
    ciphertext: requireBytes(source, "ciphertext", "envelope", KEY_BYTES),
    tag: requireBytes(source, "tag", "envelope", TAG_BYTES),
  };
  const kdf = optional(source, "kdf");
  if (envelope.type === "master") {
    if (kdf === undefined) {
      throw new ProtocolError("master envelope requires kdf parameters");
    }
    envelope.kdf = decodeKdfParams(kdf);
  } else if (kdf !== undefined) {
    throw new ProtocolError(`${envelope.type} envelope must not carry kdf parameters`);
  }
  const deviceId = optional(source, "deviceId");
  const deviceKeyVersion = optional(source, "deviceKeyVersion");
  if (envelope.type === "device") {
    if (deviceId === undefined) {
      throw new ProtocolError("device envelope requires deviceId");
    }
    if (deviceKeyVersion === undefined) {
      throw new ProtocolError("device envelope requires deviceKeyVersion");
    }
    envelope.deviceId = requireString(source, "deviceId", "envelope");
    envelope.deviceKeyVersion = requireGeneration(source, "deviceKeyVersion", "envelope");
  } else {
    if (deviceId !== undefined) {
      throw new ProtocolError(`${envelope.type} envelope must not carry deviceId`);
    }
    if (deviceKeyVersion !== undefined) {
      throw new ProtocolError(`${envelope.type} envelope must not carry deviceKeyVersion`);
    }
  }
  return envelope;
}

export function encodeDeviceKeyEnvelope(envelope: DeviceKeyEnvelope): WireDeviceKeyEnvelope {
  return {
    version: envelope.version,
    vaultId: envelope.vaultId,
    deviceId: envelope.deviceId,
    credentialId: bytesToBase64(envelope.credentialId),
    deviceKeyVersion: envelope.deviceKeyVersion,
    encryption: envelope.encryption,
    nonce: bytesToBase64(envelope.nonce),
    ciphertext: bytesToBase64(envelope.ciphertext),
    tag: bytesToBase64(envelope.tag),
  };
}

export function decodeDeviceKeyEnvelope(value: unknown): DeviceKeyEnvelope {
  const source = asRecord(value, "deviceKeyEnvelope");
  requireVersion(source, "version", "deviceKeyEnvelope");
  requireGcm(source, "deviceKeyEnvelope");
  const credentialId = requireBytes(source, "credentialId", "deviceKeyEnvelope");
  if (credentialId.length === 0) {
    throw new ProtocolError("deviceKeyEnvelope.credentialId must not be empty");
  }
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    vaultId: requireString(source, "vaultId", "deviceKeyEnvelope"),
    deviceId: requireString(source, "deviceId", "deviceKeyEnvelope"),
    credentialId,
    deviceKeyVersion: requireGeneration(source, "deviceKeyVersion", "deviceKeyEnvelope"),
    encryption: "AES-256-GCM",
    nonce: requireBytes(source, "nonce", "deviceKeyEnvelope", NONCE_BYTES),
    ciphertext: requireBytes(source, "ciphertext", "deviceKeyEnvelope", KEY_BYTES),
    tag: requireBytes(source, "tag", "deviceKeyEnvelope", TAG_BYTES),
  };
}

export function encodeEncryptedEntry(entry: EncryptedEntry): WireEncryptedEntry {
  return {
    id: entry.id,
    schemaVersion: entry.schemaVersion,
    cryptoVersion: entry.cryptoVersion,
    vaultKeyVersion: entry.vaultKeyVersion,
    nonce: bytesToBase64(entry.nonce),
    ciphertext: bytesToBase64(entry.ciphertext),
    tag: bytesToBase64(entry.tag),
  };
}

export function decodeEncryptedEntry(value: unknown): EncryptedEntry {
  const source = asRecord(value, "entry");
  const schemaVersion = requireInt(source, "schemaVersion", "entry");
  if (schemaVersion < 1) {
    throw new ProtocolError("entry.schemaVersion must be >= 1");
  }
  return {
    id: requireString(source, "id", "entry"),
    schemaVersion,
    cryptoVersion: requireVersion(source, "cryptoVersion", "entry"),
    vaultKeyVersion: requireGeneration(source, "vaultKeyVersion", "entry"),
    nonce: requireBytes(source, "nonce", "entry", NONCE_BYTES),
    ciphertext: requireBytes(source, "ciphertext", "entry"),
    tag: requireBytes(source, "tag", "entry", TAG_BYTES),
  };
}

export function encodeSealedManifest(manifest: SealedManifest): WireSealedManifest {
  return {
    version: manifest.version,
    encryption: manifest.encryption,
    nonce: bytesToBase64(manifest.nonce),
    ciphertext: bytesToBase64(manifest.ciphertext),
    tag: bytesToBase64(manifest.tag),
  };
}

export function decodeSealedManifest(value: unknown): SealedManifest {
  const source = asRecord(value, "manifest");
  requireVersion(source, "version", "manifest");
  requireGcm(source, "manifest");
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    encryption: "AES-256-GCM",
    nonce: requireBytes(source, "nonce", "manifest", NONCE_BYTES),
    ciphertext: requireBytes(source, "ciphertext", "manifest"),
    tag: requireBytes(source, "tag", "manifest", TAG_BYTES),
  };
}

export function encodeVaultSnapshot(snapshot: VaultSnapshot): WireVaultSnapshot {
  return {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    cryptoProtocolVersion: snapshot.cryptoProtocolVersion,
    manifest: encodeSealedManifest(snapshot.manifest),
    envelopes: snapshot.envelopes.map(encodeKeyEnvelope),
    entries: snapshot.entries.map(encodeEncryptedEntry),
  };
}

export function decodeVaultSnapshot(value: unknown): VaultSnapshot {
  const source = asRecord(value, "snapshot");
  const revision = requireInt(source, "revision", "snapshot");
  const vaultKeyVersion = requireInt(source, "vaultKeyVersion", "snapshot");
  if (revision < 1 || vaultKeyVersion < 1) {
    throw new ProtocolError("snapshot revision and vaultKeyVersion must be >= 1");
  }
  const envelopes = source.envelopes;
  const entries = source.entries;
  if (!Array.isArray(envelopes) || !Array.isArray(entries)) {
    throw new ProtocolError("snapshot.envelopes and snapshot.entries must be arrays");
  }
  return {
    vaultId: requireString(source, "vaultId", "snapshot"),
    revision,
    vaultKeyVersion,
    cryptoProtocolVersion: requireVersion(source, "cryptoProtocolVersion", "snapshot") as 1,
    manifest: decodeSealedManifest(source.manifest),
    envelopes: envelopes.map(decodeKeyEnvelope),
    entries: entries.map(decodeEncryptedEntry),
  };
}
