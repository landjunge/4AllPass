import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES, RECOVERY_CHECKSUM_LABEL, RECOVERY_KEY_PREFIX } from "./constants.ts";
import { recoveryHkdfInfo, recoveryHkdfSalt } from "./encoding/aad.ts";
import { assertId, assertLength, bytesToHex, equalBytes, hexToBytes, utf8 } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
import { unwrapVaultKey, wrapVaultKey, wrapVaultKeyWithNonce } from "./envelope.ts";
import { generateRecoveryKey } from "./random.ts";
import type { KeyEnvelope } from "./types.ts";

export interface DeriveRecoveryWrappingKeyOptions {
  recoveryKey: Uint8Array;
  vaultId: string;
  cryptoVersion?: number;
}

export interface WrapRecoveryOptions {
  vaultKey: Uint8Array;
  recoveryKey: Uint8Array;
  vaultId: string;
  cryptoVersion?: number;
}

/**
 * RWK = HKDF-SHA-256(IKM = recovery key, salt, info, L = 32).
 * Never use the raw recovery key as an AES key.
 */
export function deriveRecoveryWrappingKey(opts: DeriveRecoveryWrappingKeyOptions): Uint8Array {
  assertLength("recoveryKey", opts.recoveryKey, KEY_BYTES);
  assertId("vaultId", opts.vaultId);
  const cryptoVersion = opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
  const salt = sha256(recoveryHkdfSalt(opts.vaultId));
  const info = recoveryHkdfInfo(opts.vaultId, cryptoVersion);
  return hkdf(sha256, opts.recoveryKey, salt, info, KEY_BYTES);
}

function checksum4(key: Uint8Array): Uint8Array {
  return sha256(concatLabel(key)).subarray(0, 4);
}

function concatLabel(key: Uint8Array): Uint8Array {
  const label = utf8(RECOVERY_CHECKSUM_LABEL);
  const out = new Uint8Array(label.length + key.length);
  out.set(label, 0);
  out.set(key, label.length);
  return out;
}

/**
 * Emergency-Kit encoding of a 256-bit recovery key.
 *
 * `4ap1k.<64 hex key>.<8 hex checksum>`
 *
 * The checksum is SHA-256("4allpass-recovery-checksum-v1" || key)[0:4].
 * Whitespace, dashes, and case are ignored on parse.
 */
export function formatRecoveryKey(recoveryKey: Uint8Array): string {
  assertLength("recoveryKey", recoveryKey, KEY_BYTES);
  return `${RECOVERY_KEY_PREFIX}.${bytesToHex(recoveryKey)}.${bytesToHex(checksum4(recoveryKey))}`;
}

export function parseRecoveryKey(encoded: string): Uint8Array {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new ProtocolError("recovery key is required");
  }
  const compact = encoded.toLowerCase().replace(/[\s-]/g, "");
  const match =
    compact.match(/^4ap1k\.([0-9a-f]{64})\.([0-9a-f]{8})$/) ??
    compact.match(/^4ap1k([0-9a-f]{64})([0-9a-f]{8})$/);
  if (!match || !match[1] || !match[2]) {
    throw new ProtocolError("recovery key must be 4ap1k.<64 hex>.<8 hex checksum>");
  }
  const key = hexToBytes(match[1]);
  const got = hexToBytes(match[2]);
  if (!equalBytes(got, checksum4(key))) {
    throw new ProtocolError("recovery key checksum mismatch");
  }
  return key;
}

export function createRecoveryKey(): { key: Uint8Array; encoded: string } {
  const key = generateRecoveryKey();
  return { key, encoded: formatRecoveryKey(key) };
}

export function wrapRecoveryEnvelope(opts: WrapRecoveryOptions): KeyEnvelope {
  const wrappingKey = deriveRecoveryWrappingKey({
    recoveryKey: opts.recoveryKey,
    vaultId: opts.vaultId,
    ...(opts.cryptoVersion !== undefined ? { cryptoVersion: opts.cryptoVersion } : {}),
  });
  return wrapVaultKey({
    vaultKey: opts.vaultKey,
    wrappingKey,
    vaultId: opts.vaultId,
    type: "recovery",
    ...(opts.cryptoVersion !== undefined ? { cryptoVersion: opts.cryptoVersion } : {}),
  });
}

export function wrapRecoveryEnvelopeWithNonce(
  opts: WrapRecoveryOptions & { nonce: Uint8Array },
): KeyEnvelope {
  const wrappingKey = deriveRecoveryWrappingKey({
    recoveryKey: opts.recoveryKey,
    vaultId: opts.vaultId,
    ...(opts.cryptoVersion !== undefined ? { cryptoVersion: opts.cryptoVersion } : {}),
  });
  return wrapVaultKeyWithNonce({
    vaultKey: opts.vaultKey,
    wrappingKey,
    vaultId: opts.vaultId,
    type: "recovery",
    nonce: opts.nonce,
    ...(opts.cryptoVersion !== undefined ? { cryptoVersion: opts.cryptoVersion } : {}),
  });
}

export function unwrapRecoveryEnvelope(
  envelope: KeyEnvelope,
  recoveryKey: Uint8Array,
  vaultId: string,
): Uint8Array {
  if (envelope.type !== "recovery") {
    throw new ProtocolError(`expected recovery envelope, got ${envelope.type}`);
  }
  const wrappingKey = deriveRecoveryWrappingKey({
    recoveryKey,
    vaultId,
    cryptoVersion: envelope.version,
  });
  return unwrapVaultKey(envelope, wrappingKey, vaultId);
}
