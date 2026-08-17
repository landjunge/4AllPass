import { ARGON2_VERSION, HASH_LEN, NONCE_BYTES, TAG_BYTES } from "./constants.ts";
import { base64UrlToBytes, bytesToBase64Url } from "./encoding/base64url.ts";
import { ProtocolError } from "./errors.ts";
import type { DeviceKeyEnvelope, EncryptedEntry, EnvelopeType, KeyEnvelope, KdfParams } from "./types.ts";

/**
 * Keys the server and any wire parser must reject.
 * These would mean plaintext key material leaked into storage.
 */
export const FORBIDDEN_WIRE_KEYS = [
  "vaultKey",
  "wrappingKey",
  "deviceKey",
  "deviceWrappingKey",
  "prfOutput",
  "dwk",
  "masterPassword",
  "masterKey",
  "recoveryKey",
  "plaintext",
] as const;

const KEY_ENVELOPE_KEYS = new Set([
  "version",
  "type",
  "kdf",
  "deviceId",
  "encryption",
  "nonce",
  "ciphertext",
  "tag",
]);

const DEVICE_KEY_ENVELOPE_KEYS = new Set([
  "version",
  "vaultId",
  "deviceId",
  "credentialId",
  "encryption",
  "nonce",
  "ciphertext",
  "tag",
]);

const ENTRY_KEYS = new Set([
  "id",
  "schemaVersion",
  "cryptoVersion",
  "nonce",
  "ciphertext",
  "tag",
]);

export interface KdfParamsWire {
  algorithm: "argon2id";
  version: 0x13;
  memory: number;
  iterations: number;
  parallelism: number;
  hashLen: 32;
  salt: string;
}

export interface KeyEnvelopeWire {
  version: 1;
  type: EnvelopeType;
  kdf?: KdfParamsWire;
  deviceId?: string;
  encryption: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface DeviceKeyEnvelopeWire {
  version: 1;
  vaultId: string;
  deviceId: string;
  credentialId: string;
  encryption: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  tag: string;
}

export interface EncryptedEntryWire {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  tag: string;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectForbidden(record: Record<string, unknown>, label: string): void {
  for (const key of FORBIDDEN_WIRE_KEYS) {
    if (key in record) {
      throw new ProtocolError(`${label} must not contain ${key}`);
    }
  }
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ProtocolError(`${label} has unknown field ${key}`);
    }
  }
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requireInt(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ProtocolError(`${label}.${key} must be an integer`);
  }
  return value;
}

function requireB64(record: Record<string, unknown>, key: string, label: string, expectedLen?: number): Uint8Array {
  const bytes = base64UrlToBytes(requireString(record, key, label));
  if (expectedLen !== undefined && bytes.length !== expectedLen) {
    throw new ProtocolError(`${label}.${key} must be ${expectedLen} bytes`);
  }
  return bytes;
}

function requireEncryption(record: Record<string, unknown>, label: string): "AES-256-GCM" {
  const value = requireString(record, "encryption", label);
  if (value !== "AES-256-GCM") {
    throw new ProtocolError(`${label}.encryption must be AES-256-GCM`);
  }
  return value;
}

function parseKdf(value: unknown): KdfParams {
  const record = assertRecord(value, "kdf");
  rejectForbidden(record, "kdf");
  if (record.algorithm !== "argon2id") {
    throw new ProtocolError("kdf.algorithm must be argon2id");
  }
  const version = requireInt(record, "version", "kdf");
  if (version !== ARGON2_VERSION) {
    throw new ProtocolError("kdf.version must be 0x13");
  }
  const hashLen = requireInt(record, "hashLen", "kdf");
  if (hashLen !== HASH_LEN) {
    throw new ProtocolError("kdf.hashLen must be 32");
  }
  return {
    algorithm: "argon2id",
    version: ARGON2_VERSION,
    memory: requireInt(record, "memory", "kdf"),
    iterations: requireInt(record, "iterations", "kdf"),
    parallelism: requireInt(record, "parallelism", "kdf"),
    hashLen: HASH_LEN,
    salt: requireB64(record, "salt", "kdf"),
  };
}

export function keyEnvelopeToWire(envelope: KeyEnvelope): KeyEnvelopeWire {
  const wire: KeyEnvelopeWire = {
    version: 1,
    type: envelope.type,
    encryption: "AES-256-GCM",
    nonce: bytesToBase64Url(envelope.nonce),
    ciphertext: bytesToBase64Url(envelope.ciphertext),
    tag: bytesToBase64Url(envelope.tag),
  };
  if (envelope.deviceId) wire.deviceId = envelope.deviceId;
  if (envelope.kdf) {
    wire.kdf = {
      algorithm: "argon2id",
      version: ARGON2_VERSION,
      memory: envelope.kdf.memory,
      iterations: envelope.kdf.iterations,
      parallelism: envelope.kdf.parallelism,
      hashLen: HASH_LEN,
      salt: bytesToBase64Url(envelope.kdf.salt),
    };
  }
  return wire;
}

export function keyEnvelopeFromWire(value: unknown): KeyEnvelope {
  const record = assertRecord(value, "KeyEnvelope");
  rejectForbidden(record, "KeyEnvelope");
  rejectUnknown(record, KEY_ENVELOPE_KEYS, "KeyEnvelope");
  if (requireInt(record, "version", "KeyEnvelope") !== 1) {
    throw new ProtocolError("KeyEnvelope.version must be 1");
  }
  const type = requireString(record, "type", "KeyEnvelope");
  if (type !== "master" && type !== "device" && type !== "recovery") {
    throw new ProtocolError("KeyEnvelope.type is invalid");
  }
  const envelope: KeyEnvelope = {
    version: 1,
    type,
    encryption: requireEncryption(record, "KeyEnvelope"),
    nonce: requireB64(record, "nonce", "KeyEnvelope", NONCE_BYTES),
    ciphertext: requireB64(record, "ciphertext", "KeyEnvelope"),
    tag: requireB64(record, "tag", "KeyEnvelope", TAG_BYTES),
  };
  if (type === "device") {
    envelope.deviceId = requireString(record, "deviceId", "KeyEnvelope");
  } else if (record.deviceId !== undefined && record.deviceId !== "") {
    throw new ProtocolError(`${type} envelope must not carry deviceId`);
  }
  if (type === "master") {
    if (record.kdf === undefined) throw new ProtocolError("master envelope requires kdf");
    envelope.kdf = parseKdf(record.kdf);
  } else if (record.kdf !== undefined) {
    throw new ProtocolError(`${type} envelope must not carry kdf`);
  }
  return envelope;
}

export function deviceKeyEnvelopeToWire(envelope: DeviceKeyEnvelope): DeviceKeyEnvelopeWire {
  return {
    version: 1,
    vaultId: envelope.vaultId,
    deviceId: envelope.deviceId,
    credentialId: bytesToBase64Url(envelope.credentialId),
    encryption: "AES-256-GCM",
    nonce: bytesToBase64Url(envelope.nonce),
    ciphertext: bytesToBase64Url(envelope.ciphertext),
    tag: bytesToBase64Url(envelope.tag),
  };
}

export function deviceKeyEnvelopeFromWire(value: unknown): DeviceKeyEnvelope {
  const record = assertRecord(value, "DeviceKeyEnvelope");
  rejectForbidden(record, "DeviceKeyEnvelope");
  rejectUnknown(record, DEVICE_KEY_ENVELOPE_KEYS, "DeviceKeyEnvelope");
  if (requireInt(record, "version", "DeviceKeyEnvelope") !== 1) {
    throw new ProtocolError("DeviceKeyEnvelope.version must be 1");
  }
  return {
    version: 1,
    vaultId: requireString(record, "vaultId", "DeviceKeyEnvelope"),
    deviceId: requireString(record, "deviceId", "DeviceKeyEnvelope"),
    credentialId: requireB64(record, "credentialId", "DeviceKeyEnvelope"),
    encryption: requireEncryption(record, "DeviceKeyEnvelope"),
    nonce: requireB64(record, "nonce", "DeviceKeyEnvelope", NONCE_BYTES),
    ciphertext: requireB64(record, "ciphertext", "DeviceKeyEnvelope"),
    tag: requireB64(record, "tag", "DeviceKeyEnvelope", TAG_BYTES),
  };
}

export function encryptedEntryToWire(entry: EncryptedEntry): EncryptedEntryWire {
  return {
    id: entry.id,
    schemaVersion: entry.schemaVersion,
    cryptoVersion: entry.cryptoVersion,
    nonce: bytesToBase64Url(entry.nonce),
    ciphertext: bytesToBase64Url(entry.ciphertext),
    tag: bytesToBase64Url(entry.tag),
  };
}

export function encryptedEntryFromWire(value: unknown): EncryptedEntry {
  const record = assertRecord(value, "EncryptedEntry");
  rejectForbidden(record, "EncryptedEntry");
  rejectUnknown(record, ENTRY_KEYS, "EncryptedEntry");
  return {
    id: requireString(record, "id", "EncryptedEntry"),
    schemaVersion: requireInt(record, "schemaVersion", "EncryptedEntry"),
    cryptoVersion: requireInt(record, "cryptoVersion", "EncryptedEntry"),
    nonce: requireB64(record, "nonce", "EncryptedEntry", NONCE_BYTES),
    ciphertext: requireB64(record, "ciphertext", "EncryptedEntry"),
    tag: requireB64(record, "tag", "EncryptedEntry", TAG_BYTES),
  };
}
