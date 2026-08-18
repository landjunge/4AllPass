export const CRYPTO_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_SCHEMA_VERSION = 1 as const;

export const ENVELOPE_AAD_LABEL = "4allpass-envelope-v1";
export const ENTRY_AAD_LABEL = "4allpass-entry-v1";
export const DEVICE_KEY_AAD_LABEL = "4allpass-device-key-v1";
export const MANIFEST_AAD_LABEL = "4allpass-manifest-v1";
export const PRF_EVAL_LABEL = "4allpass-webauthn-prf-v1";
export const DWK_SALT_LABEL = "4allpass-dwk-salt-v1";
export const DWK_INFO_LABEL = "4allpass-device-wrap-v1";
export const KDF_PARAMS_LABEL = "4allpass-kdf-params-v1";
export const RWK_SALT_LABEL = "4allpass-rwk-salt-v1";
export const RWK_INFO_LABEL = "4allpass-recovery-wrap-v1";
export const RECOVERY_CHECKSUM_LABEL = "4allpass-recovery-checksum-v1";

/** Emergency-Kit encoding: Crockford Base32 of `key || checksum`, groups of five. */
export const RECOVERY_CHECKSUM_BYTES = 2;
export const RECOVERY_GROUP_SIZE = 5;

export const MANIFEST_CONTENT_LABEL = "4allpass-manifest-content-v1";
export const ENTRY_DIGEST_LABEL = "4allpass-entry-digest-v1";
export const ENVELOPE_DIGEST_LABEL = "4allpass-envelope-digest-v1";
export const SEALED_MANIFEST_DIGEST_LABEL = "4allpass-sealed-manifest-digest-v1";

export const ENVELOPE_TYPES = ["master", "device", "recovery"] as const;

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const DIGEST_BYTES = 32;
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
 * (see docs/threat-model.md §3, "Malicious / Active Server"). The values sit
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

export const VERSION_MAX = 0xffffffff;
/** `revision` and `vaultKeyVersion` are encoded as uint32be in AAD, so they cannot exceed this. */
export const REVISION_MAX = VERSION_MAX;

/** Identifier strings (vaultId, entryId, deviceId, rpId) are bounded before they reach AAD. */
export const ID_BYTES_MAX = 256;

/** Manifest size ceilings: a declared count must never drive an unbounded loop. */
export const MANIFEST_ENTRIES_MAX = 100_000;
export const MANIFEST_ENVELOPES_MAX = 1_000;
/** WebAuthn credential ids are 16..1023 bytes in practice; the spec allows up to 1023. */
export const CREDENTIAL_ID_BYTES_MIN = 16;
export const CREDENTIAL_ID_BYTES_MAX = 1023;

/**
 * Random 96-bit nonces: the birthday bound for a single key. Above ~2^32 seals
 * under one key the collision probability stops being negligible, so the Vault
 * Key must be rotated well before this. Documented in crypto-protocol.md §3.3.
 */
export const SEALS_PER_KEY_MAX = 2 ** 32;
