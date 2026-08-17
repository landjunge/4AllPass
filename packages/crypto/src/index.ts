export { CRYPTO_PROTOCOL_VERSION, DEFAULT_SCHEMA_VERSION } from "./constants.ts";
export {
  ARGON2_VERSION,
  DEVICE_KEY_AAD_LABEL,
  DWK_INFO_LABEL,
  DWK_SALT_LABEL,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  HASH_LEN,
  KEY_BYTES,
  NONCE_BYTES,
  PRF_EVAL_LABEL,
  PRODUCTION_MEMORY_KIB_MIN,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
  TAG_BYTES,
} from "./constants.ts";

export {
  AuthFailureError,
  CryptoError,
  IntegrityError,
  ProtocolError,
  RollbackError,
} from "./errors.ts";

export type {
  AadField,
  Argon2idParams,
  Argon2idProfile,
  Argon2idProfileName,
  DeviceKeyEnvelope,
  EncryptedEntry,
  EnvelopeType,
  GcmBox,
  KdfParams,
  KeyEnvelope,
  VaultRevision,
} from "./types.ts";

export { bytesToHex, concat, equalBytes, hexToBytes, u16be, u32be, utf8 } from "./encoding/bytes.ts";
export {
  deviceKeyAad,
  dwkHkdfInfo,
  dwkHkdfSalt,
  encodeAad,
  envelopeAad,
  entryAad,
  prfEvalFirstInput,
  versionField,
} from "./encoding/aad.ts";
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
  deriveDeviceWrappingKey,
  prfEvalFirst,
  unwrapDeviceKey,
  wrapDeviceKey,
} from "./device.ts";
export type { DeriveDeviceWrappingKeyOptions, WrapDeviceKeyOptions } from "./device.ts";

export { assertFreshSnapshot, evaluateRevision } from "./revision.ts";
export type { RevisionAction, RevisionAccept, RevisionDecision, RevisionReject } from "./revision.ts";

export {
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  randomBytes,
  randomNonce,
} from "./random.ts";

export { zeroize } from "./memory.ts";
