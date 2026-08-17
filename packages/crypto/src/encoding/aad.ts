import {
  CRYPTO_PROTOCOL_VERSION,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
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

export function envelopeAad(
  vaultId: string,
  type: EnvelopeType,
  deviceId = "",
  cryptoVersion: number = CRYPTO_PROTOCOL_VERSION,
): Uint8Array {
  return encodeAad([
    ENVELOPE_AAD_LABEL,
    vaultId,
    type,
    versionField(cryptoVersion),
    deviceId,
  ]);
}

export function entryAad(
  vaultId: string,
  entryId: string,
  schemaVersion: number,
  cryptoVersion: number = CRYPTO_PROTOCOL_VERSION,
): Uint8Array {
  return encodeAad([
    ENTRY_AAD_LABEL,
    vaultId,
    entryId,
    versionField(schemaVersion),
    versionField(cryptoVersion),
  ]);
}
