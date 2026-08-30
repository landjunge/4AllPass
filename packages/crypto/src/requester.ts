/**
 * Protocol-agnostic requester identity.
 *
 * Not a vault Device envelope. A requester cannot unwrap a Vault Key.
 * The broker never stores a shared secret for this principal.
 *
 * Pattern taken from `unwrapDeviceKey`: the caller passes expectations
 * (`expectedRequesterId`) and we compare before treating a signature as
 * authentic. Private keys never enter this module — the device (secure
 * element) signs. Tests generate keys with SubtleCrypto Ed25519.
 *
 * Transport (HTTP, MCP, a vendor API, …) is out of scope. This module
 * only answers: is this public key the enrolled requester, and did it
 * sign these bytes?
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8 } from "./encoding/bytes.ts";
import { AuthFailureError, IntegrityError, ProtocolError } from "./errors.ts";
import { assertBytes } from "./validate.ts";

export const REQUESTER_PUBLIC_KEY_BYTES = 32;
export const REQUESTER_SIGNATURE_BYTES = 64;
export const REQUESTER_ID_PREFIX = "req:ed25519:";
const MESSAGE_BYTES_MAX = 64 * 1024;

export function requesterIdFromPublicKey(publicKey: Uint8Array): string {
  const key = assertBytes("requesterPublicKey", publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  return REQUESTER_ID_PREFIX + bytesToHex(sha256(key));
}

export interface RequesterEnrollment {
  requesterId: string;
  publicKey: Uint8Array;
}

/** Public half only. The private key stays on the device. */
export function enrollRequester(publicKey: Uint8Array): RequesterEnrollment {
  const key = assertBytes("requesterPublicKey", publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  return { requesterId: requesterIdFromPublicKey(key), publicKey: new Uint8Array(key) };
}

export interface VerifyRequesterSignatureOptions {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
  /** Caller's expected id. Compared before verify — substitution is IntegrityError. */
  expectedRequesterId: string;
}

export async function verifyRequesterSignature(
  opts: VerifyRequesterSignatureOptions,
): Promise<true> {
  const publicKey = assertBytes("requesterPublicKey", opts.publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  const signature = assertBytes("requesterSignature", opts.signature, {
    exact: REQUESTER_SIGNATURE_BYTES,
  });
  const message = assertBytes("requesterMessage", opts.message, {
    min: 1,
    max: MESSAGE_BYTES_MAX,
  });
  const gotId = requesterIdFromPublicKey(publicKey);
  if (gotId !== opts.expectedRequesterId) {
    throw new IntegrityError("requesterId does not match public key");
  }
  const ok = await ed25519Verify(publicKey, message, signature);
  if (!ok) {
    throw new AuthFailureError("requester signature is not valid");
  }
  return true;
}

/**
 * Rotation: the new public key is a new requester id. The old id is not
 * rewritten. Callers revoke the old enrollment separately (policy registry).
 * Vault `deviceKeyVersion` is the wrong tool — that rotates the vault, not
 * the requester.
 */
export function rotateRequester(newPublicKey: Uint8Array): RequesterEnrollment {
  return enrollRequester(newPublicKey);
}

/** Stable request bytes. Not RFC 8785; key order is fixed here. */
export function requesterRequestBytes(fields: {
  requesterId: string;
  nonce: string;
  timestamp: number;
  action: string;
  resource: string;
}): Uint8Array {
  if (!Number.isFinite(fields.timestamp) || !Number.isInteger(fields.timestamp)) {
    throw new ProtocolError("requester timestamp must be an integer");
  }
  return utf8(
    `{"action":${JSON.stringify(fields.action)},"nonce":${JSON.stringify(fields.nonce)},"requesterId":${JSON.stringify(fields.requesterId)},"resource":${JSON.stringify(fields.resource)},"timestamp":${fields.timestamp}}`,
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function ed25519Verify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ProtocolError("no SubtleCrypto (Ed25519 verify)");
  }
  const key = await subtle.importKey("raw", toArrayBuffer(publicKey), "Ed25519", false, [
    "verify",
  ]);
  return subtle.verify("Ed25519", key, toArrayBuffer(signature), toArrayBuffer(message));
}
