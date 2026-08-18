export { CRYPTO_PROTOCOL_VERSION, DEFAULT_SCHEMA_VERSION } from "./constants.ts";
export {
  ARGON2_VERSION,
  CREDENTIAL_ID_BYTES_MAX,
  CREDENTIAL_ID_BYTES_MIN,
  DEVICE_KEY_AAD_LABEL,
  DIGEST_BYTES,
  DWK_INFO_LABEL,
  DWK_SALT_LABEL,
  ENTRY_AAD_LABEL,
  ENVELOPE_AAD_LABEL,
  ARGON2_MAXMEM_BYTES,
  HASH_LEN,
  ID_BYTES_MAX,
  KEY_BYTES,
  MANIFEST_AAD_LABEL,
  MANIFEST_ENTRIES_MAX,
  MANIFEST_ENVELOPES_MAX,
  NONCE_BYTES,
  PRF_EVAL_LABEL,
  PRODUCTION_ITERATIONS_MAX,
  PRODUCTION_ITERATIONS_MIN,
  PRODUCTION_MEMORY_KIB_MAX,
  PRODUCTION_MEMORY_KIB_MIN,
  PRODUCTION_PARALLELISM_MAX,
  PRODUCTION_PARALLELISM_MIN,
  REVISION_MAX,
  RWK_INFO_LABEL,
  RWK_SALT_LABEL,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
  SEALS_PER_KEY_MAX,
  TAG_BYTES,
  VERSION_MAX,
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
  ManifestEntryRef,
  ManifestEnvelopeRef,
  SealedManifest,
  SnapshotManifest,
  VaultRevision,
  VaultSnapshot,
} from "./types.ts";

export { bytesToHex, concat, equalBytes, hexToBytes, u16be, u32be, utf8 } from "./encoding/bytes.ts";
export { base64ToBytes, bytesToBase64 } from "./encoding/base64.ts";

export {
  decodeDeviceKeyEnvelope,
  decodeEncryptedEntry,
  decodeKdfParams,
  decodeKeyEnvelope,
  decodeVaultSnapshot,
  encodeDeviceKeyEnvelope,
  encodeEncryptedEntry,
  encodeKdfParams,
  encodeKeyEnvelope,
  encodeVaultSnapshot,
} from "./wire.ts";
export type {
  WireDeviceKeyEnvelope,
  WireEncryptedEntry,
  WireKdfParams,
  WireKeyEnvelope,
  WireVaultSnapshot,
} from "./wire.ts";
export {
  deviceKeyAad,
  dwkHkdfInfo,
  dwkHkdfSalt,
  encodeAad,
  envelopeAad,
  entryAad,
  manifestAad,
  prfEvalFirstInput,
  rwkHkdfInfo,
  rwkHkdfSalt,
  versionField,
} from "./encoding/aad.ts";
export type {
  DeviceKeyAadInput,
  EntryAadInput,
  EnvelopeAadInput,
  ManifestAadInput,
} from "./encoding/aad.ts";
export {
  entryDigest,
  envelopeDigest,
  kdfParamsDigest,
  sealedManifestDigest,
} from "./encoding/digest.ts";
export { frame } from "./encoding/framing.ts";
export { utf8Nfc } from "./encoding/unicode.ts";

export {
  ARGON2ID_PROFILES,
  DEFAULT_PROFILE,
  assertKdfBlock,
  assertKdfParamsWellFormed,
  assertKdfSalt,
  assertKdfUpperBounds,
  assertProductionKdf,
  resolveProfile,
} from "./kdf/profiles.ts";
export {
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  kdfParamsFrom,
} from "./kdf/argon2id.ts";
export type {
  DeriveMasterKeyFromEnvelopeOptions,
  DeriveMasterKeyOptions,
} from "./kdf/argon2id.ts";

export { assertAeadFraming, decrypt, decryptBox, encrypt } from "./aead/aes-gcm.ts";

export { wrapVaultKey, unwrapVaultKey } from "./envelope.ts";
export type { UnwrapVaultKeyOptions, WrapVaultKeyOptions } from "./envelope.ts";

export { encryptEntry, decryptEntry } from "./entry.ts";
export type { DecryptEntryOptions, EncryptEntryOptions } from "./entry.ts";

export {
  bindDeviceWithPrfOutput,
  bindDeviceWithWrappingKey,
  deriveDeviceWrappingKey,
  prfEvalFirst,
  unwrapDeviceKey,
  unwrapVaultKeyWithDeviceWrappingKey,
  unwrapVaultKeyWithPrfOutput,
  wrapDeviceKey,
} from "./device.ts";
export type {
  DeriveDeviceWrappingKeyOptions,
  DeviceBinding,
  DeviceBindingInput,
  DeviceUnlockInput,
  DeviceWrappingKeyUnlockInput,
  LocalDeviceBindingInput,
  UnwrapDeviceKeyOptions,
  WrapDeviceKeyOptions,
} from "./device.ts";

export {
  assertSnapshotMatchesManifest,
  buildManifest,
  decodeManifest,
  encodeManifest,
  normalizeSnapshotContents,
  openManifest,
  sealManifest,
  validateManifest,
  verifySnapshotManifest,
} from "./manifest.ts";
export type {
  BuildManifestOptions,
  OpenManifestOptions,
  SealManifestOptions,
  SnapshotContents,
  VerifiedManifest,
  VerifiedSnapshot,
} from "./manifest.ts";

export {
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  parseRecoveryKey,
} from "./recovery.ts";
export type { DeriveRecoveryWrappingKeyOptions } from "./recovery.ts";

export { assertFreshSnapshot, evaluateRevision, revisionFromManifest } from "./revision.ts";
export type { RevisionAction, RevisionAccept, RevisionDecision, RevisionReject } from "./revision.ts";

export { unlockSnapshot, verifySnapshot } from "./snapshot.ts";
export type {
  CrossCheckEnvelope,
  DecryptedEntry,
  UnlockedSnapshot,
  UnlockSnapshotOptions,
  VerifySnapshotOptions,
} from "./snapshot.ts";

export {
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  randomBytes,
  randomNonce,
} from "./random.ts";

export {
  assertBytes,
  assertId,
  assertRevision,
  assertUint32,
  assertVersion,
} from "./validate.ts";

export { zeroize } from "./memory.ts";
