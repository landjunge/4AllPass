import { KEY_BYTES, NONCE_BYTES, SALT_BYTES_MIN } from "./constants.ts";
import { ProtocolError } from "./errors.ts";

function getRandomValues(bytes: Uint8Array): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new ProtocolError("no CSPRNG available (crypto.getRandomValues)");
  }
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
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
  return randomBytes(bytes);
}
