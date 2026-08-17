import {
  CRYPTO_PROTOCOL_VERSION,
  DEFAULT_SCHEMA_VERSION,
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
} from "./constants.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { entryAad, type EntryAadInput } from "./encoding/aad.ts";
import { ProtocolError } from "./errors.ts";
import {
  assertBytes,
  assertId,
  assertVersion,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";
import type { EncryptedEntry, GcmBox } from "./types.ts";

export interface EncryptEntryOptions {
  vaultKey: Uint8Array;
  vaultId: string;
  entryId: string;
  plaintext: Uint8Array;
  /** Vault-Key generation of the snapshot this entry is written into. */
  vaultKeyVersion: number;
  schemaVersion?: number;
  cryptoVersion?: number;
}

export interface DecryptEntryOptions {
  vaultKey: Uint8Array;
  vaultId: string;
  /** The entry the caller asked for. Compared against `entry.id`. */
  entryId: string;
  /** Vault-Key generation of the snapshot the entry was served in. */
  vaultKeyVersion: number;
}

function prepareEncrypt(opts: EncryptEntryOptions): EntryAadInput {
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  assertBytes("plaintext", opts.plaintext);
  const fields: EntryAadInput = {
    vaultId: assertId("vaultId", opts.vaultId),
    entryId: assertId("entryId", opts.entryId),
    schemaVersion: assertVersion("schemaVersion", opts.schemaVersion ?? DEFAULT_SCHEMA_VERSION),
    cryptoVersion: assertVersion("cryptoVersion", opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION),
    vaultKeyVersion: assertVersion("vaultKeyVersion", opts.vaultKeyVersion),
  };
  if (fields.cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes entry cryptoVersion ${CRYPTO_PROTOCOL_VERSION}`);
  }
  return fields;
}

function buildEntry(fields: EntryAadInput, box: GcmBox): EncryptedEntry {
  return {
    id: fields.entryId,
    schemaVersion: fields.schemaVersion,
    cryptoVersion: fields.cryptoVersion,
    vaultKeyVersion: fields.vaultKeyVersion,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function encryptEntry(opts: EncryptEntryOptions): EncryptedEntry {
  const fields = prepareEncrypt(opts);
  return buildEntry(fields, encrypt(opts.vaultKey, opts.plaintext, entryAad(fields)));
}

/** Test-only encrypt with a fixed nonce. */
export function encryptEntryWithNonce(
  opts: EncryptEntryOptions & { nonce: Uint8Array },
): EncryptedEntry {
  const fields = prepareEncrypt(opts);
  return buildEntry(
    fields,
    encryptWithNonce(opts.vaultKey, opts.nonce, opts.plaintext, entryAad(fields)),
  );
}

/**
 * Decrypt using the versions stored on the entry, against the identity the
 * caller asked for.
 *
 * `entry.id` is part of the AAD, which proves the record is self-consistent but
 * says nothing about *which* record it is: a server can serve entry X's sealed
 * record in the slot the client requested for entry Y and the tag still
 * verifies. `opts.entryId` and `opts.vaultKeyVersion` are therefore mandatory
 * and compared first.
 */
export function decryptEntry(entry: EncryptedEntry, opts: DecryptEntryOptions): Uint8Array {
  if (entry === null || typeof entry !== "object") {
    throw new ProtocolError("entry must be an object");
  }
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  // Each byte field is read exactly once, so validation and use cannot disagree.
  const nonce = assertBytes("entry.nonce", entry.nonce, { exact: NONCE_BYTES });
  const ciphertext = assertBytes("entry.ciphertext", entry.ciphertext);
  const tag = assertBytes("entry.tag", entry.tag, { exact: TAG_BYTES });

  const cryptoVersion = assertVersion("entry.cryptoVersion", entry.cryptoVersion);
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported entry cryptoVersion: ${cryptoVersion}`);
  }
  const fields: EntryAadInput = {
    vaultId: assertId("vaultId", opts.vaultId),
    entryId: assertId("entry.id", entry.id),
    schemaVersion: assertVersion("entry.schemaVersion", entry.schemaVersion),
    cryptoVersion,
    vaultKeyVersion: assertVersion("entry.vaultKeyVersion", entry.vaultKeyVersion),
  };

  requireSameString("entry.id", assertId("opts.entryId", opts.entryId), fields.entryId);
  requireSameNumber(
    "entry.vaultKeyVersion",
    assertVersion("opts.vaultKeyVersion", opts.vaultKeyVersion),
    fields.vaultKeyVersion,
  );

  return decrypt(opts.vaultKey, nonce, ciphertext, tag, entryAad(fields));
}
