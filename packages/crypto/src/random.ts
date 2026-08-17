import { KEY_BYTES, NONCE_BYTES, SALT_BYTES_MAX, SALT_BYTES_MIN } from "./constants.ts";
import { ProtocolError } from "./errors.ts";

/** `crypto.getRandomValues` refuses more than 65 536 bytes per call. */
const RANDOM_BYTES_MAX = 65536;

function getRandomValues(bytes: Uint8Array): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new ProtocolError("no CSPRNG available (crypto.getRandomValues)");
  }
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > RANDOM_BYTES_MAX) {
    throw new ProtocolError(`random byte count must be an integer in [1, ${RANDOM_BYTES_MAX}]`);
  }
  return getRandomValues(new Uint8Array(length));
}

export function randomNonce(): Uint8Array {
  return randomBytes(NONCE_BYTES);
}

export function generateVaultKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function generateRecoveryKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function generateDeviceKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function generateSalt(bytes: 16 | 32 = SALT_BYTES_MIN): Uint8Array {
  if (bytes !== SALT_BYTES_MIN && bytes !== SALT_BYTES_MAX) {
    throw new ProtocolError(`salt must be ${SALT_BYTES_MIN} or ${SALT_BYTES_MAX} bytes`);
  }
  return randomBytes(bytes);
}
