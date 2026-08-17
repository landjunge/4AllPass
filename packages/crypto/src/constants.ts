export const CRYPTO_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_SCHEMA_VERSION = 1 as const;

export const ENVELOPE_AAD_LABEL = "4allpass-envelope-v1";
export const ENTRY_AAD_LABEL = "4allpass-entry-v1";
export const DEVICE_KEY_AAD_LABEL = "4allpass-device-key-v1";
export const PRF_EVAL_LABEL = "4allpass-webauthn-prf-v1";
export const DWK_SALT_LABEL = "4allpass-dwk-salt-v1";
export const DWK_INFO_LABEL = "4allpass-device-wrap-v1";

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const SALT_BYTES_MIN = 16;
export const SALT_BYTES_MAX = 32;
export const ARGON2_VERSION = 0x13;
export const HASH_LEN = 32;

/** Production KDF memory floor (KiB). `ci` is 32 KiB and is below this. */
export const PRODUCTION_MEMORY_KIB_MIN = 32 * 1024;

/**
 * KDF parameter ceilings. A malicious server controls the (unauthenticated)
 * kdf block of a master envelope; without ceilings it can request multi-GiB
 * allocations or absurd iteration counts and DoS the client at unlock.
 */
export const MEMORY_KIB_MAX = 1024 * 1024; // 1 GiB
export const ITERATIONS_MAX = 32;
export const PARALLELISM_MAX = 16;
