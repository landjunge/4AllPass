export const CRYPTO_PROTOCOL_VERSION = 1 as const;

export const ENVELOPE_AAD_LABEL = "4allpass-envelope-v1";
export const ENTRY_AAD_LABEL = "4allpass-entry-v1";

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const SALT_BYTES_MIN = 16;
export const SALT_BYTES_MAX = 32;
export const ARGON2_VERSION = 0x13;
export const HASH_LEN = 32;

/** Production KDF memory floor (KiB). `ci` is 32 KiB and is below this. */
export const PRODUCTION_MEMORY_KIB_MIN = 32 * 1024;
