import { sha256 } from "@noble/hashes/sha2.js";
import { equalBytes, utf8 } from "@4allpass/crypto";
import { UserVerificationError } from "./errors.ts";

const RP_ID_HASH_BYTES = 32;
const FLAGS_OFFSET = 32;
const MIN_LENGTH = 37;

export interface AuthenticatorDataFlags {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backedUp: boolean;
  attestedCredentialData: boolean;
  extensionData: boolean;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: AuthenticatorDataFlags;
  signCount: number;
}

export function parseAuthenticatorData(data: ArrayBuffer | Uint8Array): ParsedAuthenticatorData {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < MIN_LENGTH) {
    throw new UserVerificationError(`authenticatorData is too short (${bytes.length} bytes)`);
  }
  const flags = bytes[FLAGS_OFFSET] as number;
  return {
    rpIdHash: bytes.subarray(0, RP_ID_HASH_BYTES),
    flags: {
      userPresent: (flags & 0x01) !== 0,
      userVerified: (flags & 0x04) !== 0,
      backupEligible: (flags & 0x08) !== 0,
      backedUp: (flags & 0x10) !== 0,
      attestedCredentialData: (flags & 0x40) !== 0,
      extensionData: (flags & 0x80) !== 0,
    },
    signCount:
      ((bytes[33] as number) << 24) |
      ((bytes[34] as number) << 16) |
      ((bytes[35] as number) << 8) |
      (bytes[36] as number),
  };
}

/**
 * `userVerification: "required"` is a request, not a guarantee: the flag in
 * authenticatorData is the only proof that the authenticator actually verified
 * the user. Rank 3 releases locally stored key material on the strength of this
 * check, so it is enforced for every assertion.
 */
export function assertUserVerified(
  authenticatorData: ArrayBuffer | Uint8Array,
  rpId: string,
): ParsedAuthenticatorData {
  const parsed = parseAuthenticatorData(authenticatorData);
  if (!equalBytes(parsed.rpIdHash, sha256(utf8(rpId)))) {
    throw new UserVerificationError(`assertion is for a different rpId than ${rpId}`);
  }
  if (!parsed.flags.userPresent) {
    throw new UserVerificationError("assertion completed without user presence");
  }
  if (!parsed.flags.userVerified) {
    throw new UserVerificationError();
  }
  return parsed;
}
