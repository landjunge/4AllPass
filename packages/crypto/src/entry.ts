import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES } from "./constants.ts";
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
}

export function encryptEntry(opts: EncryptEntryOptions): EncryptedEntry {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  const schemaVersion = opts.schemaVersion ?? CRYPTO_PROTOCOL_VERSION;
  const aad = entryAad(opts.vaultId, opts.entryId, schemaVersion);
  const box = encrypt(opts.vaultKey, opts.plaintext, aad);
  return {
    id: opts.entryId,
    version: CRYPTO_PROTOCOL_VERSION,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function encryptEntryWithNonce(
  opts: EncryptEntryOptions & { nonce: Uint8Array },
): EncryptedEntry {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  const schemaVersion = opts.schemaVersion ?? CRYPTO_PROTOCOL_VERSION;
  const aad = entryAad(opts.vaultId, opts.entryId, schemaVersion);
  const box = encryptWithNonce(opts.vaultKey, opts.nonce, opts.plaintext, aad);
  return {
    id: opts.entryId,
    version: CRYPTO_PROTOCOL_VERSION,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function decryptEntry(
  entry: EncryptedEntry,
  vaultKey: Uint8Array,
  vaultId: string,
  schemaVersion: number = CRYPTO_PROTOCOL_VERSION,
): Uint8Array {
  if (entry.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported entry version: ${entry.version}`);
  }
  assertLength("vaultKey", vaultKey, KEY_BYTES);
  const aad = entryAad(vaultId, entry.id, schemaVersion);
  return decrypt(vaultKey, entry.nonce, entry.ciphertext, entry.tag, aad);
}
