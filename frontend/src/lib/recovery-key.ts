/**
 * Emergency-Kit encoding from `@4allpass/crypto` (docs/recovery.md).
 * Crockford Base32 of `key || checksum`; the printed key is never used as AES.
 */
export { formatRecoveryKey, parseRecoveryKey } from "@4allpass/crypto";
