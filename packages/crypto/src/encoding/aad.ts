import {
  DEVICE_KEY_AAD_LABEL,
  DWK_INFO_LABEL,
  DWK_SALT_LABEL,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  PRF_EVAL_LABEL,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import type { AadField, EnvelopeType } from "../types.ts";
import { concat, u16be, u32be, utf8 } from "./bytes.ts";

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
): Uint8Array {
  return encodeAad([
    DEVICE_KEY_AAD_LABEL,
    vaultId,
    deviceId,
    credentialId,
    versionField(cryptoVersion),
  ]);
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
