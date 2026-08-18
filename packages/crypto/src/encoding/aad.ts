import {
  DEVICE_KEY_AAD_LABEL,
  DWK_INFO_LABEL,
  DWK_SALT_LABEL,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  MANIFEST_AAD_LABEL,
  PRF_EVAL_LABEL,
  RWK_INFO_LABEL,
  RWK_SALT_LABEL,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import type { AadField, EnvelopeType, KdfParams } from "../types.ts";
import { concat, u16be, u32be, utf8 } from "./bytes.ts";
import { kdfParamsDigest } from "./digest.ts";

/**
 * Canonical v1 AAD: each field is `uint16be(len) || bytes`.
 * Strings are UTF-8 without a trailing NUL.
 * Integer versions must be passed as 4-byte uint32be (use `versionField`).
 *
 * Every builder below takes a named-field object on purpose: positional
 * arguments of the same type are exactly how an AAD field ends up swapped.
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

export interface EnvelopeAadInput {
  vaultId: string;
  type: EnvelopeType;
  cryptoVersion: number;
  vaultKeyVersion: number;
  /** Empty for master / recovery envelopes. */
  deviceId: string;
  /** 0 for master / recovery envelopes. */
  deviceKeyVersion: number;
  /** Master envelopes only; everything else passes `undefined`. */
  kdf?: KdfParams | undefined;
}

/**
 * All envelope metadata is authenticated, including the KDF parameters
 * (via digest) and both key generations. `cryptoVersion` is the `version`
 * stored on that same envelope — never a library default.
 */
export function envelopeAad(input: EnvelopeAadInput): Uint8Array {
  return encodeAad([
    ENVELOPE_AAD_LABEL,
    input.vaultId,
    input.type,
    versionField(input.cryptoVersion),
    versionField(input.vaultKeyVersion),
    input.deviceId,
    versionField(input.deviceKeyVersion),
    input.kdf ? kdfParamsDigest(input.kdf) : new Uint8Array(0),
  ]);
}

export interface EntryAadInput {
  vaultId: string;
  entryId: string;
  schemaVersion: number;
  cryptoVersion: number;
  vaultKeyVersion: number;
}

/** schemaVersion, cryptoVersion and vaultKeyVersion come from the EncryptedEntry. Never guessed. */
export function entryAad(input: EntryAadInput): Uint8Array {
  return encodeAad([
    ENTRY_AAD_LABEL,
    input.vaultId,
    input.entryId,
    versionField(input.schemaVersion),
    versionField(input.cryptoVersion),
    versionField(input.vaultKeyVersion),
  ]);
}

export interface DeviceKeyAadInput {
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  cryptoVersion: number;
  deviceKeyVersion: number;
}

export function deviceKeyAad(input: DeviceKeyAadInput): Uint8Array {
  return encodeAad([
    DEVICE_KEY_AAD_LABEL,
    input.vaultId,
    input.deviceId,
    input.credentialId,
    versionField(input.cryptoVersion),
    versionField(input.deviceKeyVersion),
  ]);
}

export interface ManifestAadInput {
  vaultId: string;
  cryptoVersion: number;
  revision: number;
  vaultKeyVersion: number;
}

/**
 * Binding `revision` into AAD is what makes the revision number a
 * cryptographic statement instead of server-supplied metadata.
 */
export function manifestAad(input: ManifestAadInput): Uint8Array {
  return encodeAad([
    MANIFEST_AAD_LABEL,
    input.vaultId,
    versionField(input.cryptoVersion),
    versionField(input.revision),
    versionField(input.vaultKeyVersion),
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

export function rwkHkdfSalt(vaultId: string): Uint8Array {
  return encodeAad([RWK_SALT_LABEL, vaultId]);
}

export function rwkHkdfInfo(vaultId: string, cryptoVersion: number): Uint8Array {
  return encodeAad([RWK_INFO_LABEL, vaultId, versionField(cryptoVersion)]);
}
