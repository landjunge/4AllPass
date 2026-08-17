import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  CREDENTIAL_ID_BYTES_MAX,
  CREDENTIAL_ID_BYTES_MIN,
  CRYPTO_PROTOCOL_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
} from "./constants.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import {
  deviceKeyAad,
  dwkHkdfInfo,
  dwkHkdfSalt,
  prfEvalFirstInput,
  type DeviceKeyAadInput,
} from "./encoding/aad.ts";
import { ProtocolError } from "./errors.ts";
import {
  assertBytes,
  assertId,
  assertVersion,
  requireSameBytes,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";
import type { DeviceKeyEnvelope, GcmBox } from "./types.ts";

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
  const nonce = assertBytes("envelope.nonce", envelope.nonce, { exact: NONCE_BYTES });
  const ciphertext = assertBytes("envelope.ciphertext", envelope.ciphertext, { exact: KEY_BYTES });
  const tag = assertBytes("envelope.tag", envelope.tag, { exact: TAG_BYTES });

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
