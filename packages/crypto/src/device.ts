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
import { assertLength, equalBytes } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
import { zeroize } from "./memory.ts";
import { generateDeviceKey } from "./random.ts";
import { unwrapVaultKey, wrapVaultKey } from "./envelope.ts";
import type { DeviceKeyEnvelope, KeyEnvelope } from "./types.ts";

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

export interface DeviceBindingInput {
  /** `prf.results.first`. Zeroized before this call returns. */
  prfOutput: Uint8Array;
  /** Vault Key of the currently unlocked vault. Stays owned by the caller. */
  vaultKey: Uint8Array;
  rpId: string;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  cryptoVersion?: number;
}

export interface DeviceBinding {
  /** Wrapped under the DWK. Stored locally (or mirrored as an opaque blob). */
  deviceKeyEnvelope: DeviceKeyEnvelope;
  /** Wrapped under the Device Key. Uploaded to the server. */
  deviceEnvelope: KeyEnvelope;
}

export interface DeviceUnlockInput {
  /** `prf.results.first`. Zeroized before this call returns. */
  prfOutput: Uint8Array;
  deviceKeyEnvelope: DeviceKeyEnvelope;
  deviceEnvelope: KeyEnvelope;
  rpId: string;
  /**
   * Credential that produced `prfOutput`. Checked against the envelope so a
   * PRF output from a different credential fails before any AES-GCM call.
   */
  credentialId?: Uint8Array;
}

function assertEnvelopePair(
  deviceKeyEnvelope: DeviceKeyEnvelope,
  deviceEnvelope: KeyEnvelope,
): void {
  if (deviceEnvelope.type !== "device") {
    throw new ProtocolError(`expected a device envelope, got ${deviceEnvelope.type}`);
  }
  if (deviceEnvelope.deviceId !== deviceKeyEnvelope.deviceId) {
    throw new ProtocolError("device envelope and device-key envelope disagree on deviceId");
  }
}

/**
 * Registration steps 4–8 of webauthn-prf.md §2.1: mint a random Device Key,
 * wrap it under the DWK, and wrap the Vault Key under the Device Key.
 *
 * PRF output, DWK, and DK never leave this function; all three are zeroized
 * before it returns. The Vault Key is not re-derived and never touched by the
 * WebAuthn path — the DWK is not an encryption oracle for it.
 */
export function bindDeviceWithPrfOutput(input: DeviceBindingInput): DeviceBinding {
  assertLength("vaultKey", input.vaultKey, KEY_BYTES);
  const cryptoVersion = input.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  const dwk = deriveDeviceWrappingKey({
    prfOutput: input.prfOutput,
    rpId: input.rpId,
    vaultId: input.vaultId,
    deviceId: input.deviceId,
    credentialId: input.credentialId,
    cryptoVersion,
  });
  const deviceKey = generateDeviceKey();
  try {
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: dwk,
      vaultId: input.vaultId,
      deviceId: input.deviceId,
      credentialId: input.credentialId,
      cryptoVersion,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey: input.vaultKey,
      wrappingKey: deviceKey,
      vaultId: input.vaultId,
      type: "device",
      deviceId: input.deviceId,
      cryptoVersion,
    });
    return { deviceKeyEnvelope, deviceEnvelope };
  } finally {
    zeroize(deviceKey, dwk, input.prfOutput);
  }
}

/**
 * Unlock steps 4–7 of webauthn-prf.md §2.2: PRF output → DWK → DK → VK.
 *
 * Ids and versions are read from the envelopes, never guessed. PRF output,
 * DWK, and DK are zeroized before this returns; only the Vault Key survives.
 */
export function unwrapVaultKeyWithPrfOutput(input: DeviceUnlockInput): Uint8Array {
  const { deviceKeyEnvelope, deviceEnvelope } = input;
  assertEnvelopePair(deviceKeyEnvelope, deviceEnvelope);
  if (input.credentialId && !equalBytes(input.credentialId, deviceKeyEnvelope.credentialId)) {
    zeroize(input.prfOutput);
    throw new ProtocolError("credentialId does not match the device-key envelope");
  }
  const dwk = deriveDeviceWrappingKey({
    prfOutput: input.prfOutput,
    rpId: input.rpId,
    vaultId: deviceKeyEnvelope.vaultId,
    deviceId: deviceKeyEnvelope.deviceId,
    credentialId: deviceKeyEnvelope.credentialId,
    cryptoVersion: deviceKeyEnvelope.version,
  });
  let deviceKey: Uint8Array | undefined;
  try {
    deviceKey = unwrapDeviceKey(deviceKeyEnvelope, dwk);
    return unwrapVaultKey(deviceEnvelope, deviceKey, deviceKeyEnvelope.vaultId);
  } finally {
    zeroize(deviceKey, dwk, input.prfOutput);
  }
}

/**
 * Fallback rank 2/3 of webauthn-prf.md §5: the Device-Key Envelope came from
 * largeBlob or from a UV-gated local store, so the wrapping key is already a
 * 32-byte key instead of a PRF output. The DK → VK half is identical.
 *
 * `wrappingKey` is zeroized before returning, so callers that keep a stored
 * copy must pass a clone.
 */
export function unwrapVaultKeyWithDeviceWrappingKey(
  deviceKeyEnvelope: DeviceKeyEnvelope,
  deviceEnvelope: KeyEnvelope,
  wrappingKey: Uint8Array,
): Uint8Array {
  assertEnvelopePair(deviceKeyEnvelope, deviceEnvelope);
  let deviceKey: Uint8Array | undefined;
  try {
    deviceKey = unwrapDeviceKey(deviceKeyEnvelope, wrappingKey);
    return unwrapVaultKey(deviceEnvelope, deviceKey, deviceKeyEnvelope.vaultId);
  } finally {
    zeroize(deviceKey, wrappingKey);
  }
}

export function unwrapDeviceKey(envelope: DeviceKeyEnvelope, deviceWrappingKey: Uint8Array): Uint8Array {
  if (envelope.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported device-key envelope version: ${envelope.version}`);
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
