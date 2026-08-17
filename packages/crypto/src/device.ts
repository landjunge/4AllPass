import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES } from "./constants.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import {
  deviceKeyAad,
  dwkHkdfInfo,
  dwkHkdfSalt,
  prfEvalFirstInput,
} from "./encoding/aad.ts";
import { assertId, assertLength, assertVersionCounter } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";
import type { DeviceKeyEnvelope } from "./types.ts";

export interface DeriveDeviceWrappingKeyOptions {
  prfOutput: Uint8Array;
  rpId: string;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  cryptoVersion?: number;
}

export interface WrapDeviceKeyOptions {
  deviceKey: Uint8Array;
  deviceWrappingKey: Uint8Array;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  /** Defaults to 1. Increment only when this device's DK is rotated. */
  deviceKeyVersion?: number;
  cryptoVersion?: number;
}

/**
 * Value for `publicKey.extensions.prf.eval.first`.
 * SHA-256 of the length-prefixed context so the authenticator sees 32 bytes.
 */
export function prfEvalFirst(rpId: string, vaultId: string): Uint8Array {
  return sha256(prfEvalFirstInput(rpId, vaultId));
}

/**
 * DWK = HKDF-SHA-256(IKM = PRF output, salt, info, L = 32).
 * Binds RP ID, vault, device, and credential. Never use raw PRF output as a key.
 */
export function deriveDeviceWrappingKey(opts: DeriveDeviceWrappingKeyOptions): Uint8Array {
  assertLength("prfOutput", opts.prfOutput, KEY_BYTES);
  const cryptoVersion = opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  const salt = sha256(dwkHkdfSalt(opts.vaultId, opts.credentialId));
  const info = dwkHkdfInfo(
    opts.rpId,
    opts.vaultId,
    opts.deviceId,
    opts.credentialId,
    cryptoVersion,
  );
  return hkdf(sha256, opts.prfOutput, salt, info, KEY_BYTES);
}

function resolveDeviceKeyVersion(value: number | undefined): number {
  const deviceKeyVersion = value ?? 1;
  assertVersionCounter("deviceKeyVersion", deviceKeyVersion);
  return deviceKeyVersion;
}

function resolveDeviceCryptoVersion(cryptoVersion: number | undefined): number {
  const version = cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  if (version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes device-key envelope version ${CRYPTO_PROTOCOL_VERSION}`);
  }
  return version;
}

function buildDeviceKeyEnvelope(
  opts: WrapDeviceKeyOptions,
  cryptoVersion: number,
  deviceKeyVersion: number,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
): DeviceKeyEnvelope {
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    vaultId: opts.vaultId,
    deviceId: opts.deviceId,
    credentialId: opts.credentialId,
    deviceKeyVersion,
    encryption: "AES-256-GCM",
    nonce,
    ciphertext,
    tag,
  };
}

export function wrapDeviceKey(opts: WrapDeviceKeyOptions): DeviceKeyEnvelope {
  assertLength("deviceKey", opts.deviceKey, KEY_BYTES);
  assertLength("deviceWrappingKey", opts.deviceWrappingKey, KEY_BYTES);
  assertId("vaultId", opts.vaultId);
  assertId("deviceId", opts.deviceId);
  const cryptoVersion = resolveDeviceCryptoVersion(opts.cryptoVersion);
  const deviceKeyVersion = resolveDeviceKeyVersion(opts.deviceKeyVersion);
  const aad = deviceKeyAad(
    opts.vaultId,
    opts.deviceId,
    opts.credentialId,
    cryptoVersion,
    deviceKeyVersion,
  );
  const box = encrypt(opts.deviceWrappingKey, opts.deviceKey, aad);
  return buildDeviceKeyEnvelope(opts, cryptoVersion, deviceKeyVersion, box.nonce, box.ciphertext, box.tag);
}

export function wrapDeviceKeyWithNonce(
  opts: WrapDeviceKeyOptions & { nonce: Uint8Array },
): DeviceKeyEnvelope {
  assertLength("deviceKey", opts.deviceKey, KEY_BYTES);
  assertLength("deviceWrappingKey", opts.deviceWrappingKey, KEY_BYTES);
  assertId("vaultId", opts.vaultId);
  assertId("deviceId", opts.deviceId);
  const cryptoVersion = resolveDeviceCryptoVersion(opts.cryptoVersion);
  const deviceKeyVersion = resolveDeviceKeyVersion(opts.deviceKeyVersion);
  const aad = deviceKeyAad(
    opts.vaultId,
    opts.deviceId,
    opts.credentialId,
    cryptoVersion,
    deviceKeyVersion,
  );
  const box = encryptWithNonce(opts.deviceWrappingKey, opts.nonce, opts.deviceKey, aad);
  return buildDeviceKeyEnvelope(opts, cryptoVersion, deviceKeyVersion, box.nonce, box.ciphertext, box.tag);
}

export function unwrapDeviceKey(envelope: DeviceKeyEnvelope, deviceWrappingKey: Uint8Array): Uint8Array {
  if (envelope.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported device-key envelope version: ${envelope.version}`);
  }
  assertLength("deviceWrappingKey", deviceWrappingKey, KEY_BYTES);
  assertVersionCounter("deviceKeyVersion", envelope.deviceKeyVersion);
  const aad = deviceKeyAad(
    envelope.vaultId,
    envelope.deviceId,
    envelope.credentialId,
    envelope.version,
    envelope.deviceKeyVersion,
  );
  const dk = decrypt(
    deviceWrappingKey,
    envelope.nonce,
    envelope.ciphertext,
    envelope.tag,
    aad,
  );
  assertLength("deviceKey", dk, KEY_BYTES);
  return dk;
}

/**
 * Refuse a Device-Key Envelope whose version went backwards.
 * A missing pin (first unlock on this device) is accepted.
 */
export function assertDeviceKeyVersion(lastSeen: number | null, incoming: number): "first_seen" | "same" | "advance" {
  assertVersionCounter("incoming deviceKeyVersion", incoming);
  if (lastSeen === null) return "first_seen";
  assertVersionCounter("lastSeen deviceKeyVersion", lastSeen);
  if (incoming < lastSeen) {
    throw new IntegrityError(`deviceKeyVersion downgrade: ${incoming} < ${lastSeen}`);
  }
  return incoming === lastSeen ? "same" : "advance";
}
