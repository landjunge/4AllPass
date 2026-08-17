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
import { assertLength } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
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

export function wrapDeviceKey(opts: WrapDeviceKeyOptions): DeviceKeyEnvelope {
  assertLength("deviceKey", opts.deviceKey, KEY_BYTES);
  assertLength("deviceWrappingKey", opts.deviceWrappingKey, KEY_BYTES);
  const cryptoVersion = opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes device-key envelope version ${CRYPTO_PROTOCOL_VERSION}`);
  }
  const aad = deviceKeyAad(opts.vaultId, opts.deviceId, opts.credentialId, cryptoVersion);
  const box = encrypt(opts.deviceWrappingKey, opts.deviceKey, aad);
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    vaultId: opts.vaultId,
    deviceId: opts.deviceId,
    credentialId: opts.credentialId,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function wrapDeviceKeyWithNonce(
  opts: WrapDeviceKeyOptions & { nonce: Uint8Array },
): DeviceKeyEnvelope {
  assertLength("deviceKey", opts.deviceKey, KEY_BYTES);
  assertLength("deviceWrappingKey", opts.deviceWrappingKey, KEY_BYTES);
  const cryptoVersion = opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes device-key envelope version ${CRYPTO_PROTOCOL_VERSION}`);
  }
  const aad = deviceKeyAad(opts.vaultId, opts.deviceId, opts.credentialId, cryptoVersion);
  const box = encryptWithNonce(opts.deviceWrappingKey, opts.nonce, opts.deviceKey, aad);
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    vaultId: opts.vaultId,
    deviceId: opts.deviceId,
    credentialId: opts.credentialId,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function unwrapDeviceKey(envelope: DeviceKeyEnvelope, deviceWrappingKey: Uint8Array): Uint8Array {
  if (envelope.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported device-key envelope version: ${envelope.version}`);
  }
  if (envelope.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported device-key envelope encryption: ${envelope.encryption}`);
  }
  assertLength("deviceWrappingKey", deviceWrappingKey, KEY_BYTES);
  const aad = deviceKeyAad(
    envelope.vaultId,
    envelope.deviceId,
    envelope.credentialId,
    envelope.version,
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
