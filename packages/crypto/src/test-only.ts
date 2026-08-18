/**
 * Test-only hooks. Import from `@4allpass/crypto/test-only`.
 * These accept caller-supplied nonces / raw Argon2 inputs so known-answer
 * tests can be reproduced. Production code must not import this module.
 *
 * The guard below is a tripwire, not a security boundary: bundlers replace
 * `process.env.NODE_ENV` at build time, so a production web build that imports
 * this module fails loudly instead of shipping a nonce-accepting API.
 */
const nodeEnv = globalThis.process?.env?.NODE_ENV;
if (nodeEnv === "production") {
  throw new Error(
    "@4allpass/crypto/test-only was imported in a production build. " +
      "Production code must use the nonce-owning API from @4allpass/crypto.",
  );
}

export { encryptWithNonce } from "./aead/aes-gcm.ts";
export { deriveArgon2idRaw } from "./kdf/argon2id.ts";
export { wrapVaultKeyWithNonce } from "./envelope.ts";
export { encryptEntryWithNonce } from "./entry.ts";
export { wrapDeviceKeyWithNonce } from "./device.ts";
export { sealManifestWithNonce } from "./manifest.ts";
