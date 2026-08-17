export const CRYPTO_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_SCHEMA_VERSION = 1 as const;

export const ENVELOPE_AAD_LABEL = "4allpass-envelope-v1";
export const ENTRY_AAD_LABEL = "4allpass-entry-v1";
export const DEVICE_KEY_AAD_LABEL = "4allpass-device-key-v1";
export const PRF_EVAL_LABEL = "4allpass-webauthn-prf-v1";
export const DWK_SALT_LABEL = "4allpass-dwk-salt-v1";
export const DWK_INFO_LABEL = "4allpass-device-wrap-v1";
export const MANIFEST_AAD_LABEL = "4allpass-manifest-v1";
export const MANIFEST_SALT_LABEL = "4allpass-manifest-salt-v1";
export const MANIFEST_KEY_LABEL = "4allpass-manifest-key-v1";
export const MANIFEST_BODY_LABEL = "4allpass-manifest-body-v1";
export const BOX_DIGEST_LABEL = "4allpass-box-digest-v1";
export const RECOVERY_SALT_LABEL = "4allpass-recovery-salt-v1";
export const RECOVERY_INFO_LABEL = "4allpass-recovery-wrap-v1";
export const RECOVERY_CHECKSUM_LABEL = "4allpass-recovery-checksum-v1";
export const RECOVERY_KEY_PREFIX = "4ap1k";

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const SALT_BYTES_MIN = 16;
export const SALT_BYTES_MAX = 32;
export const ARGON2_VERSION = 0x13;
export const HASH_LEN = 32;

/** Production KDF memory floor (KiB). `ci` is 32 KiB and is below this. */
export const PRODUCTION_MEMORY_KIB_MIN = 32 * 1024;
