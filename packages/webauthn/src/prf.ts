/**
 * WebAuthn assertion → `prf.results.first` (webauthn-prf.md §2.2 steps 1–3).
 *
 * The 32 bytes returned here are not a key. They are HKDF input material and
 * must be handed straight to `deriveDeviceWrappingKey` (or to the crypto-core
 * helpers that do it and zeroize afterwards).
 */
import { equalBytes, KEY_BYTES, prfEvalFirst, randomBytes } from "@4allpass/crypto";
import { assertUserVerified } from "./authenticator-data.ts";
import { PrfUnavailableError, WebAuthnUnavailableError } from "./errors.ts";
import type {
  ExtensionBytes,
  ExtensionResultsLike,
  GetAssertionRequest,
  WebAuthnClient,
} from "./types.ts";

export const CHALLENGE_BYTES = 32;

export function newChallenge(): Uint8Array {
  return randomBytes(CHALLENGE_BYTES);
}

export function toBytes(value: ExtensionBytes | undefined): Uint8Array | null {
  if (!value) return null;
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Reads `results.first`, rejecting missing or short output (§2.2 step 3). */
export function readPrfFirst(results: ExtensionResultsLike): Uint8Array {
  const first = toBytes(results.prf?.results?.first);
  if (!first) {
    throw new PrfUnavailableError();
  }
  if (first.length !== KEY_BYTES) {
    throw new PrfUnavailableError(
      `prf.results.first must be ${KEY_BYTES} bytes, got ${first.length}`,
    );
  }
  return first;
}

export interface PrfAssertionRequest {
  client: WebAuthnClient;
  rpId: string;
  vaultId: string;
  credentialId: Uint8Array;
}

/**
 * One UV-required assertion that evaluates the PRF for this (rpId, vaultId).
 * Verifies the UV flag and that the authenticator answered with the credential
 * we asked for before the PRF output is used for anything.
 */
export async function assertPrfOutput(request: PrfAssertionRequest): Promise<Uint8Array> {
  const assertionRequest: GetAssertionRequest = {
    rpId: request.rpId,
    challenge: newChallenge(),
    credentialId: request.credentialId,
    userVerification: "required",
    prfEvalFirst: prfEvalFirst(request.rpId, request.vaultId),
  };
  const assertion = await request.client.get(assertionRequest);
  assertUserVerified(assertion.authenticatorData, request.rpId);
  if (!equalBytes(new Uint8Array(assertion.rawId), request.credentialId)) {
    throw new WebAuthnUnavailableError("authenticator answered with a different credential");
  }
  return readPrfFirst(assertion.extensionResults);
}
