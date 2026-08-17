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
 * KDF parameter ceilings. Enforced even for the test profile, because these
 * bounds exist to stop a malicious server from weaponizing an untrusted
 * Master Envelope's `kdf` field into a client-side resource-exhaustion DoS
 * (see docs/threat-model.md §2, "Malicious / Active Server"). The values sit
 * comfortably above the strongest documented production profile (`high`:
 * 128 MiB / t=4 / p=4) while blocking absurd requests.
 */
export const PRODUCTION_MEMORY_KIB_MAX = 512 * 1024; // 512 MiB
export const PRODUCTION_ITERATIONS_MIN = 3;
export const PRODUCTION_ITERATIONS_MAX = 16;
export const PRODUCTION_PARALLELISM_MIN = 1;
export const PRODUCTION_PARALLELISM_MAX = 16;

/**
 * Absolute upper bound (bytes) passed to Argon2id as `maxmem`, derived from
 * `PRODUCTION_MEMORY_KIB_MAX`. This is a fixed backstop; it must never scale
 * with the caller-supplied `memory` parameter, or the guard is defeated.
 */
export const ARGON2_MAXMEM_BYTES = PRODUCTION_MEMORY_KIB_MAX * 1024 * 2;
