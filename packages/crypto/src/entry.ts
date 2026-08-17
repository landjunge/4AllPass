import { CRYPTO_PROTOCOL_VERSION, DEFAULT_SCHEMA_VERSION, KEY_BYTES } from "./constants.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { entryAad } from "./encoding/aad.ts";
import { assertLength } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
import type { EncryptedEntry } from "./types.ts";

export interface EncryptEntryOptions {
  vaultKey: Uint8Array;
  vaultId: string;
  entryId: string;
  plaintext: Uint8Array;
  schemaVersion?: number;
  cryptoVersion?: number;
}

function resolveVersions(opts: EncryptEntryOptions): {
  schemaVersion: number;
  cryptoVersion: number;
} {
  return {
    schemaVersion: opts.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
    cryptoVersion: opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION,
  };
}

export function encryptEntry(opts: EncryptEntryOptions): EncryptedEntry {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  const { schemaVersion, cryptoVersion } = resolveVersions(opts);
  const aad = entryAad(opts.vaultId, opts.entryId, schemaVersion, cryptoVersion);
  const box = encrypt(opts.vaultKey, opts.plaintext, aad);
  return {
    id: opts.entryId,
    schemaVersion,
    cryptoVersion,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function encryptEntryWithNonce(
  opts: EncryptEntryOptions & { nonce: Uint8Array },
): EncryptedEntry {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  const { schemaVersion, cryptoVersion } = resolveVersions(opts);
  const aad = entryAad(opts.vaultId, opts.entryId, schemaVersion, cryptoVersion);
  const box = encryptWithNonce(opts.vaultKey, opts.nonce, opts.plaintext, aad);
  return {
    id: opts.entryId,
    schemaVersion,
    cryptoVersion,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

/** Decrypt using the versions stored on the entry. The caller must not guess them. */
export function decryptEntry(
  entry: EncryptedEntry,
  vaultKey: Uint8Array,
  vaultId: string,
): Uint8Array {
  if (entry.cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported entry cryptoVersion: ${entry.cryptoVersion}`);
  }
  if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 1) {
    throw new ProtocolError(`invalid schemaVersion: ${entry.schemaVersion}`);
  }
  assertLength("vaultKey", vaultKey, KEY_BYTES);
  const aad = entryAad(vaultId, entry.id, entry.schemaVersion, entry.cryptoVersion);
  return decrypt(vaultKey, entry.nonce, entry.ciphertext, entry.tag, aad);
}
