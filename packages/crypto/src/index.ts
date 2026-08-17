export { CRYPTO_PROTOCOL_VERSION } from "./constants.ts";
export {
  ARGON2_VERSION,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  HASH_LEN,
  KEY_BYTES,
  NONCE_BYTES,
  PRODUCTION_MEMORY_KIB_MIN,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
  TAG_BYTES,
} from "./constants.ts";

export { AuthFailureError, CryptoError, ProtocolError } from "./errors.ts";

export type {
  AadField,
  Argon2idParams,
  Argon2idProfile,
  Argon2idProfileName,
  EncryptedEntry,
  EnvelopeType,
  GcmBox,
  KdfParams,
  KeyEnvelope,
} from "./types.ts";

export { bytesToHex, concat, equalBytes, hexToBytes, u16be, u32be, utf8 } from "./encoding/bytes.ts";
export { encodeAad, envelopeAad, entryAad, versionField } from "./encoding/aad.ts";
export { utf8Nfc } from "./encoding/unicode.ts";

export {
  ARGON2ID_PROFILES,
  DEFAULT_PROFILE,
  assertProductionKdf,
  resolveProfile,
} from "./kdf/profiles.ts";
export {
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  kdfParamsFrom,
} from "./kdf/argon2id.ts";

export { decrypt, decryptBox, encrypt } from "./aead/aes-gcm.ts";

export { wrapVaultKey, unwrapVaultKey } from "./envelope.ts";
export type { WrapVaultKeyOptions } from "./envelope.ts";

export { encryptEntry, decryptEntry } from "./entry.ts";
export type { EncryptEntryOptions } from "./entry.ts";

export {
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  randomBytes,
  randomNonce,
} from "./random.ts";

export { zeroize } from "./memory.ts";
