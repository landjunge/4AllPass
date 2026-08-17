import {
  BOX_DIGEST_LABEL,
  DEVICE_KEY_AAD_LABEL,
  DWK_INFO_LABEL,
  DWK_SALT_LABEL,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  MANIFEST_AAD_LABEL,
  MANIFEST_BODY_LABEL,
  MANIFEST_KEY_LABEL,
  MANIFEST_SALT_LABEL,
  PRF_EVAL_LABEL,
  RECOVERY_INFO_LABEL,
  RECOVERY_SALT_LABEL,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import type { AadField, EnvelopeType } from "../types.ts";
import { assertId, assertVersionCounter, concat, u16be, u32be, utf8 } from "./bytes.ts";

/**
 * Canonical v1 AAD: each field is `uint16be(len) || bytes`.
 * Strings are UTF-8 without a trailing NUL.
 * Integer versions must be passed as 4-byte uint32be (use `versionField`).
 */
export function encodeAad(fields: readonly AadField[]): Uint8Array {
  if (fields.length === 0) {
    throw new ProtocolError("AAD must contain at least one field");
  }
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    const bytes = typeof field === "string" ? utf8(field) : field;
    if (bytes.length > 0xffff) {
      throw new ProtocolError(`AAD field exceeds 65535 bytes (${bytes.length})`);
    }
    parts.push(u16be(bytes.length), bytes);
  }
  return concat(...parts);
}

export function versionField(version: number): Uint8Array {
  return u32be(version);
}

/** cryptoVersion is taken from the envelope being wrapped/unwrapped. Never implicit. */
export function envelopeAad(
  vaultId: string,
  type: EnvelopeType,
  deviceId: string,
  cryptoVersion: number,
): Uint8Array {
  assertId("vaultId", vaultId);
  return encodeAad([
    ENVELOPE_AAD_LABEL,
    vaultId,
    type,
    versionField(cryptoVersion),
    deviceId,
  ]);
}

/** schemaVersion and cryptoVersion come from the EncryptedEntry object. Never guessed. */
export function entryAad(
  vaultId: string,
  entryId: string,
  schemaVersion: number,
  cryptoVersion: number,
): Uint8Array {
  assertId("vaultId", vaultId);
  assertId("entryId", entryId);
  return encodeAad([
    ENTRY_AAD_LABEL,
    vaultId,
    entryId,
    versionField(schemaVersion),
    versionField(cryptoVersion),
  ]);
}

export function deviceKeyAad(
  vaultId: string,
  deviceId: string,
  credentialId: Uint8Array,
  cryptoVersion: number,
  deviceKeyVersion: number,
): Uint8Array {
  assertId("vaultId", vaultId);
  assertId("deviceId", deviceId);
  assertVersionCounter("deviceKeyVersion", deviceKeyVersion);
  return encodeAad([
    DEVICE_KEY_AAD_LABEL,
    vaultId,
    deviceId,
    credentialId,
    versionField(cryptoVersion),
    versionField(deviceKeyVersion),
  ]);
}

export function manifestAad(
  vaultId: string,
  revision: number,
  vaultKeyVersion: number,
  cryptoVersion: number,
): Uint8Array {
  assertId("vaultId", vaultId);
  assertVersionCounter("revision", revision);
  assertVersionCounter("vaultKeyVersion", vaultKeyVersion);
  return encodeAad([
    MANIFEST_AAD_LABEL,
    vaultId,
    versionField(revision),
    versionField(vaultKeyVersion),
    versionField(cryptoVersion),
  ]);
}

export function manifestHkdfSalt(vaultId: string): Uint8Array {
  assertId("vaultId", vaultId);
  return encodeAad([MANIFEST_SALT_LABEL, vaultId]);
}

export function manifestHkdfInfo(
  vaultId: string,
  revision: number,
  vaultKeyVersion: number,
  cryptoVersion: number,
): Uint8Array {
  assertId("vaultId", vaultId);
  assertVersionCounter("revision", revision);
  assertVersionCounter("vaultKeyVersion", vaultKeyVersion);
  return encodeAad([
    MANIFEST_KEY_LABEL,
    vaultId,
    versionField(revision),
    versionField(vaultKeyVersion),
    versionField(cryptoVersion),
  ]);
}

export function manifestBodyHeader(
  vaultId: string,
  revision: number,
  vaultKeyVersion: number,
  cryptoProtocolVersion: number,
): Uint8Array {
  return encodeAad([
    MANIFEST_BODY_LABEL,
    vaultId,
    versionField(revision),
    versionField(vaultKeyVersion),
    versionField(cryptoProtocolVersion),
  ]);
}

export function boxDigestPreimage(nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Uint8Array {
  return encodeAad([BOX_DIGEST_LABEL, nonce, ciphertext, tag]);
}

export function recoveryHkdfSalt(vaultId: string): Uint8Array {
  assertId("vaultId", vaultId);
  return encodeAad([RECOVERY_SALT_LABEL, vaultId]);
}

export function recoveryHkdfInfo(vaultId: string, cryptoVersion: number): Uint8Array {
  assertId("vaultId", vaultId);
  return encodeAad([RECOVERY_INFO_LABEL, vaultId, versionField(cryptoVersion)]);
}

export function prfEvalFirstInput(rpId: string, vaultId: string): Uint8Array {
  return encodeAad([PRF_EVAL_LABEL, rpId, vaultId]);
}

export function dwkHkdfSalt(vaultId: string, credentialId: Uint8Array): Uint8Array {
  return encodeAad([DWK_SALT_LABEL, vaultId, credentialId]);
}

export function dwkHkdfInfo(
  rpId: string,
  vaultId: string,
  deviceId: string,
  credentialId: Uint8Array,
  cryptoVersion: number,
): Uint8Array {
  return encodeAad([
    DWK_INFO_LABEL,
    rpId,
    vaultId,
    deviceId,
    credentialId,
    versionField(cryptoVersion),
  ]);
}
