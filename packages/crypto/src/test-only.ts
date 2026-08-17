/**
 * Test-only hooks. Import from `@4allpass/crypto/test-only`.
 * These accept caller-supplied nonces / raw Argon2 inputs so known-answer
 * tests can be reproduced. Production code must not import this module.
 */
export { encryptWithNonce } from "./aead/aes-gcm.ts";
export { deriveArgon2idRaw } from "./kdf/argon2id.ts";
export { wrapVaultKeyWithNonce } from "./envelope.ts";
export { encryptEntryWithNonce } from "./entry.ts";
export { wrapDeviceKeyWithNonce } from "./device.ts";
export { sealManifestWithNonce } from "./manifest.ts";
export { wrapRecoveryEnvelopeWithNonce } from "./recovery.ts";
