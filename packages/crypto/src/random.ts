import { KEY_BYTES, NONCE_BYTES, SALT_BYTES_MIN } from "./constants.ts";
import { ProtocolError } from "./errors.ts";

function getRandomValues(bytes: Uint8Array): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new ProtocolError("no CSPRNG available (crypto.getRandomValues)");
  }
  // `bytes` is always backed by a plain ArrayBuffer (constructed via
  // `new Uint8Array(length)` below), never a SharedArrayBuffer. The cast
  // satisfies DOM lib's `ArrayBufferView<ArrayBuffer>` constraint on
  // `getRandomValues` under TypeScript's generic typed-array types.
  cryptoObj.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
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
