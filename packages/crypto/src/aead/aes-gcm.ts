import { gcm } from "@noble/ciphers/aes.js";
import { KEY_BYTES, NONCE_BYTES, TAG_BYTES } from "../constants.ts";
import { AuthFailureError, ProtocolError } from "../errors.ts";
import { assertLength } from "../encoding/bytes.ts";
import type { GcmBox } from "../types.ts";
import { randomNonce } from "../random.ts";

export function splitCiphertextTag(sealed: Uint8Array): {
  ciphertext: Uint8Array;
  tag: Uint8Array;
} {
  if (sealed.length < TAG_BYTES) {
    throw new ProtocolError("sealed blob shorter than GCM tag");
  }
  return {
    ciphertext: sealed.subarray(0, sealed.length - TAG_BYTES),
    tag: sealed.subarray(sealed.length - TAG_BYTES),
  };
}

export function joinCiphertextTag(ciphertext: Uint8Array, tag: Uint8Array): Uint8Array {
  assertLength("tag", tag, TAG_BYTES);
  const out = new Uint8Array(ciphertext.length + TAG_BYTES);
  out.set(ciphertext, 0);
  out.set(tag, ciphertext.length);
  return out;
}

function assertKeyNonce(key: Uint8Array, nonce: Uint8Array): void {
  assertLength("key", key, KEY_BYTES);
  assertLength("nonce", nonce, NONCE_BYTES);
}

/**
 * Framing check for AEAD material read from an *untrusted* source (an
 * envelope or entry served by a possibly-malicious server). A wrong-length
 * nonce or tag is a tampered/malformed blob, not a programmer mistake, so it
 * must surface as an `AuthFailureError` — the same class every other failed
 * authenticated decryption produces. Callers commonly catch only
 * `AuthFailureError` for the "corrupt / wrong key" path; leaking a
 * `ProtocolError` here would turn a malformed blob into an uncaught crash.
 */
export function assertAeadFraming(nonce: Uint8Array, tag: Uint8Array): void {
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new AuthFailureError();
  }
}

/** Production encrypt. Nonce is generated inside the library. */
export function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): GcmBox {
  return encryptWithNonce(key, randomNonce(), plaintext, aad);
}

/**
 * Test-only: caller-supplied nonce to reproduce known-answer tests.
 * Do not use this in production paths.
 */
export function encryptWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): GcmBox {
  assertKeyNonce(key, nonce);
  const sealed = gcm(key, nonce, aad).encrypt(plaintext);
  const { ciphertext, tag } = splitCiphertextTag(sealed);
  return { nonce, ciphertext, tag };
}

export function decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  assertKeyNonce(key, nonce);
  assertLength("tag", tag, TAG_BYTES);
  try {
    return gcm(key, nonce, aad).decrypt(joinCiphertextTag(ciphertext, tag));
  } catch {
    throw new AuthFailureError();
  }
}

export function decryptBox(key: Uint8Array, box: GcmBox, aad: Uint8Array): Uint8Array {
  return decrypt(key, box.nonce, box.ciphertext, box.tag, aad);
}
