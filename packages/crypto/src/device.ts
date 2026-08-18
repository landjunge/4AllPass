import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  CREDENTIAL_ID_BYTES_MAX,
  CREDENTIAL_ID_BYTES_MIN,
  CRYPTO_PROTOCOL_VERSION,
  KEY_BYTES,
} from "./constants.ts";
import { assertAeadFraming, decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import {
  deviceKeyAad,
  dwkHkdfInfo,
  dwkHkdfSalt,
  prfEvalFirstInput,
  type DeviceKeyAadInput,
} from "./encoding/aad.ts";
import { equalBytes } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
import { unwrapVaultKey, wrapVaultKey } from "./envelope.ts";
import { zeroize } from "./memory.ts";
import { generateDeviceKey } from "./random.ts";
import type { DeviceKeyEnvelope, GcmBox, KeyEnvelope } from "./types.ts";
import {
  assertBytes,
  assertId,
  assertVersion,
  requireSameBytes,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";

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
  /** Device-Key generation. Incremented on every local Device-Key rotation. */
  deviceKeyVersion: number;
  cryptoVersion?: number;
}

export interface UnwrapDeviceKeyOptions {
  deviceWrappingKey: Uint8Array;
  /** The vault, device, credential and Device-Key generation the caller expects. */
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  deviceKeyVersion: number;
}

function assertCredentialId(value: unknown): Uint8Array {
  return assertBytes("credentialId", value, {
    min: CREDENTIAL_ID_BYTES_MIN,
    max: CREDENTIAL_ID_BYTES_MAX,
  });
}

/**
 * Value for `publicKey.extensions.prf.eval.first`.
 * SHA-256 of the length-prefixed context so the authenticator sees 32 bytes.
 */
export function prfEvalFirst(rpId: string, vaultId: string): Uint8Array {
  return sha256(prfEvalFirstInput(assertId("rpId", rpId), assertId("vaultId", vaultId)));
}

/**
 * DWK = HKDF-SHA-256(IKM = PRF output, salt, info, L = 32).
 * Binds RP ID, vault, device, and credential. Never use raw PRF output as a key.
 *
 * An all-zero PRF output is rejected: that is what a broken or non-PRF
 * authenticator path produces, and accepting it would silently derive a
 * publicly computable wrapping key.
 */
export function deriveDeviceWrappingKey(opts: DeriveDeviceWrappingKeyOptions): Uint8Array {
  assertBytes("prfOutput", opts.prfOutput, { exact: KEY_BYTES });
  if (opts.prfOutput.every((b) => b === 0)) {
    throw new ProtocolError("prfOutput is all zero — authenticator did not return PRF material");
  }
  const rpId = assertId("rpId", opts.rpId);
  const vaultId = assertId("vaultId", opts.vaultId);
  const deviceId = assertId("deviceId", opts.deviceId);
  const credentialId = assertCredentialId(opts.credentialId);
  const cryptoVersion = assertVersion("cryptoVersion", opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION);
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported device crypto version: ${cryptoVersion}`);
  }
  const salt = sha256(dwkHkdfSalt(vaultId, credentialId));
  const info = dwkHkdfInfo(rpId, vaultId, deviceId, credentialId, cryptoVersion);
  return hkdf(sha256, opts.prfOutput, salt, info, KEY_BYTES);
}

function prepareDeviceKeyWrap(opts: WrapDeviceKeyOptions): DeviceKeyAadInput {
  assertBytes("deviceKey", opts.deviceKey, { exact: KEY_BYTES });
  assertBytes("deviceWrappingKey", opts.deviceWrappingKey, { exact: KEY_BYTES });
  const cryptoVersion = assertVersion("cryptoVersion", opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION);
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(
      `this library only writes device-key envelope version ${CRYPTO_PROTOCOL_VERSION}`,
    );
  }
  return {
    vaultId: assertId("vaultId", opts.vaultId),
    deviceId: assertId("deviceId", opts.deviceId),
    credentialId: assertCredentialId(opts.credentialId),
    cryptoVersion,
    deviceKeyVersion: assertVersion("deviceKeyVersion", opts.deviceKeyVersion),
  };
}

function buildDeviceKeyEnvelope(fields: DeviceKeyAadInput, box: GcmBox): DeviceKeyEnvelope {
  return {
    version: fields.cryptoVersion,
    vaultId: fields.vaultId,
    deviceId: fields.deviceId,
    credentialId: fields.credentialId,
    deviceKeyVersion: fields.deviceKeyVersion,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function wrapDeviceKey(opts: WrapDeviceKeyOptions): DeviceKeyEnvelope {
  const fields = prepareDeviceKeyWrap(opts);
  return buildDeviceKeyEnvelope(
    fields,
    encrypt(opts.deviceWrappingKey, opts.deviceKey, deviceKeyAad(fields)),
  );
}

export function wrapDeviceKeyWithNonce(
  opts: WrapDeviceKeyOptions & { nonce: Uint8Array },
): DeviceKeyEnvelope {
  const fields = prepareDeviceKeyWrap(opts);
  return buildDeviceKeyEnvelope(
    fields,
    encryptWithNonce(opts.deviceWrappingKey, opts.nonce, opts.deviceKey, deviceKeyAad(fields)),
  );
}

/**
 * Open a Device-Key Envelope against explicit expectations.
 *
 * The envelope carries its own `vaultId`, `deviceId` and `credentialId`, and the
 * AAD is built from them. That makes the envelope internally consistent but
 * self-referential: an envelope belonging to another vault, another device or
 * another credential unwraps happily as long as the matching DWK is derived from
 * the same envelope fields. The caller must therefore state what it expects.
 */
export function unwrapDeviceKey(
  envelope: DeviceKeyEnvelope,
  opts: UnwrapDeviceKeyOptions,
): Uint8Array {
  if (envelope === null || typeof envelope !== "object") {
    throw new ProtocolError("device-key envelope must be an object");
  }
  if (envelope.encryption !== "AES-256-GCM") {
    throw new ProtocolError(
      `unsupported device-key envelope encryption: ${String(envelope.encryption)}`,
    );
  }
  assertBytes("deviceWrappingKey", opts.deviceWrappingKey, { exact: KEY_BYTES });
  // Each byte field is read exactly once, so validation and use cannot disagree.
  const nonce = assertBytes("envelope.nonce", envelope.nonce);
  const ciphertext = assertBytes("envelope.ciphertext", envelope.ciphertext);
  const tag = assertBytes("envelope.tag", envelope.tag);
  assertAeadFraming(nonce, tag, ciphertext, KEY_BYTES);

  const cryptoVersion = assertVersion("envelope.version", envelope.version);
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported device-key envelope version: ${cryptoVersion}`);
  }
  const fields: DeviceKeyAadInput = {
    vaultId: assertId("envelope.vaultId", envelope.vaultId),
    deviceId: assertId("envelope.deviceId", envelope.deviceId),
    credentialId: assertCredentialId(envelope.credentialId),
    cryptoVersion,
    deviceKeyVersion: assertVersion("envelope.deviceKeyVersion", envelope.deviceKeyVersion),
  };

  requireSameString("envelope.vaultId", assertId("opts.vaultId", opts.vaultId), fields.vaultId);
  requireSameString("envelope.deviceId", assertId("opts.deviceId", opts.deviceId), fields.deviceId);
  requireSameBytes(
    "envelope.credentialId",
    assertCredentialId(opts.credentialId),
    fields.credentialId,
  );
  requireSameNumber(
    "envelope.deviceKeyVersion",
    assertVersion("opts.deviceKeyVersion", opts.deviceKeyVersion),
    fields.deviceKeyVersion,
  );

  const dk = decrypt(opts.deviceWrappingKey, nonce, ciphertext, tag, deviceKeyAad(fields));
  assertBytes("deviceKey", dk, { exact: KEY_BYTES });
  return dk;
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
  vaultKeyVersion: number;
  deviceKeyVersion: number;
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
  vaultId: string;
  vaultKeyVersion: number;
  deviceKeyVersion: number;
  /**
   * Credential that produced `prfOutput`. Compared against the envelope so a
   * PRF output from a different credential fails before any AES-GCM call.
   */
  credentialId: Uint8Array;
}

export interface LocalDeviceBindingInput {
  /**
   * 32-byte wrapping key for the Device-Key Envelope. Owned by the caller,
   * because fallback ranks 2 and 3 have to persist it (largeBlob or local
   * store); it is not zeroized here.
   */
  deviceWrappingKey: Uint8Array;
  vaultKey: Uint8Array;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  vaultKeyVersion: number;
  deviceKeyVersion: number;
  cryptoVersion?: number;
}

export interface DeviceWrappingKeyUnlockInput {
  deviceKeyEnvelope: DeviceKeyEnvelope;
  deviceEnvelope: KeyEnvelope;
  wrappingKey: Uint8Array;
  vaultId: string;
  vaultKeyVersion: number;
  deviceKeyVersion: number;
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
  if (deviceEnvelope.deviceKeyVersion !== deviceKeyEnvelope.deviceKeyVersion) {
    throw new ProtocolError("device envelope and device-key envelope disagree on deviceKeyVersion");
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
  const cryptoVersion = input.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  const dwk = deriveDeviceWrappingKey({
    prfOutput: input.prfOutput,
    rpId: input.rpId,
    vaultId: input.vaultId,
    deviceId: input.deviceId,
    credentialId: input.credentialId,
    cryptoVersion,
  });
  try {
    return bindDeviceWithWrappingKey({
      deviceWrappingKey: dwk,
      vaultKey: input.vaultKey,
      vaultId: input.vaultId,
      deviceId: input.deviceId,
      credentialId: input.credentialId,
      vaultKeyVersion: input.vaultKeyVersion,
      deviceKeyVersion: input.deviceKeyVersion,
      cryptoVersion,
    });
  } finally {
    zeroize(dwk, input.prfOutput);
  }
}

/**
 * Same envelope pair as `bindDeviceWithPrfOutput`, but for fallback ranks 2
 * and 3 where the wrapping key is a stored random key instead of an HKDF
 * output. The Device Key is generated here and zeroized before returning.
 */
export function bindDeviceWithWrappingKey(input: LocalDeviceBindingInput): DeviceBinding {
  assertBytes("vaultKey", input.vaultKey, { exact: KEY_BYTES });
  const cryptoVersion = input.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  const deviceKey = generateDeviceKey();
  try {
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: input.deviceWrappingKey,
      vaultId: input.vaultId,
      deviceId: input.deviceId,
      credentialId: input.credentialId,
      deviceKeyVersion: input.deviceKeyVersion,
      cryptoVersion,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey: input.vaultKey,
      wrappingKey: deviceKey,
      vaultId: input.vaultId,
      type: "device",
      vaultKeyVersion: input.vaultKeyVersion,
      deviceId: input.deviceId,
      deviceKeyVersion: input.deviceKeyVersion,
      cryptoVersion,
    });
    return { deviceKeyEnvelope, deviceEnvelope };
  } finally {
    zeroize(deviceKey);
  }
}

function openDeviceEnvelopePair(
  deviceKeyEnvelope: DeviceKeyEnvelope,
  deviceEnvelope: KeyEnvelope,
  wrappingKey: Uint8Array,
  vaultId: string,
  vaultKeyVersion: number,
  deviceKeyVersion: number,
): Uint8Array {
  assertEnvelopePair(deviceKeyEnvelope, deviceEnvelope);
  const deviceKey = unwrapDeviceKey(deviceKeyEnvelope, {
    deviceWrappingKey: wrappingKey,
    vaultId,
    deviceId: deviceKeyEnvelope.deviceId,
    credentialId: deviceKeyEnvelope.credentialId,
    deviceKeyVersion,
  });
  try {
    return unwrapVaultKey(deviceEnvelope, {
      wrappingKey: deviceKey,
      vaultId,
      expectType: "device",
      expectVaultKeyVersion: vaultKeyVersion,
      expectDeviceId: deviceKeyEnvelope.deviceId,
      expectDeviceKeyVersion: deviceKeyVersion,
    });
  } finally {
    zeroize(deviceKey);
  }
}

/**
 * Unlock steps 4–7 of webauthn-prf.md §2.2: PRF output → DWK → DK → VK.
 *
 * Opening is done against the caller's expectations. PRF output, DWK, and DK
 * are zeroized before this returns; only the Vault Key survives.
 */
export function unwrapVaultKeyWithPrfOutput(input: DeviceUnlockInput): Uint8Array {
  const { deviceKeyEnvelope, deviceEnvelope } = input;
  if (!equalBytes(input.credentialId, deviceKeyEnvelope.credentialId)) {
    zeroize(input.prfOutput);
    throw new ProtocolError("credentialId does not match the device-key envelope");
  }
  const dwk = deriveDeviceWrappingKey({
    prfOutput: input.prfOutput,
    rpId: input.rpId,
    vaultId: input.vaultId,
    deviceId: deviceKeyEnvelope.deviceId,
    credentialId: deviceKeyEnvelope.credentialId,
    cryptoVersion: deviceKeyEnvelope.version,
  });
  try {
    return openDeviceEnvelopePair(
      deviceKeyEnvelope,
      deviceEnvelope,
      dwk,
      input.vaultId,
      input.vaultKeyVersion,
      input.deviceKeyVersion,
    );
  } finally {
    zeroize(dwk, input.prfOutput);
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
  input: DeviceWrappingKeyUnlockInput,
): Uint8Array {
  try {
    return openDeviceEnvelopePair(
      input.deviceKeyEnvelope,
      input.deviceEnvelope,
      input.wrappingKey,
      input.vaultId,
      input.vaultKeyVersion,
      input.deviceKeyVersion,
    );
  } finally {
    zeroize(input.wrappingKey);
  }
}
