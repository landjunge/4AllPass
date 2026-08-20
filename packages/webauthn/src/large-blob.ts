/**
 * Fallback rank 2 (webauthn-prf.md §5): the Device-Key Envelope is stored in
 * the authenticator's largeBlob, while its wrapping key stays in local storage.
 * An attacker with only the local store has the key but not the envelope, and
 * an attacker with only the authenticator has the envelope but not the key.
 */
import { decodeDeviceKeyEnvelope, encodeDeviceKeyEnvelope, utf8 } from "@4allpass/crypto";
import type { DeviceKeyEnvelope } from "@4allpass/crypto";
import { assertUserVerified } from "./authenticator-data.ts";
import { DeviceUnlockError, WebAuthnUnavailableError } from "./errors.ts";
import { toBytes } from "./prf.ts";
import { resolveChallenge, type ChallengeProvider } from "./challenge.ts";
import type { WebAuthnClient } from "./types.ts";

export interface LargeBlobRequest {
  client: WebAuthnClient;
  rpId: string;
  credentialId: Uint8Array;
  challenges?: ChallengeProvider | undefined;
}

export function serializeDeviceKeyEnvelope(envelope: DeviceKeyEnvelope): Uint8Array {
  return utf8(JSON.stringify(encodeDeviceKeyEnvelope(envelope)));
}

export function parseDeviceKeyEnvelope(blob: Uint8Array): DeviceKeyEnvelope {
  const text = new TextDecoder().decode(blob);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DeviceUnlockError("largeBlob does not contain a JSON device-key envelope", { cause });
  }
  return decodeDeviceKeyEnvelope(parsed);
}

export async function writeLargeBlob(
  request: LargeBlobRequest & { envelope: DeviceKeyEnvelope },
): Promise<void> {
  const assertion = await request.client.get({
    rpId: request.rpId,
    challenge: await resolveChallenge("assert", request.challenges),
    credentialId: request.credentialId,
    userVerification: "required",
    largeBlob: { write: serializeDeviceKeyEnvelope(request.envelope) },
  });
  assertUserVerified(assertion.authenticatorData, request.rpId);
  if (assertion.extensionResults.largeBlob?.written !== true) {
    throw new WebAuthnUnavailableError("authenticator did not write the largeBlob");
  }
}

export async function readLargeBlob(request: LargeBlobRequest): Promise<DeviceKeyEnvelope> {
  const assertion = await request.client.get({
    rpId: request.rpId,
    challenge: await resolveChallenge("assert", request.challenges),
    credentialId: request.credentialId,
    userVerification: "required",
    largeBlob: { read: true },
  });
  assertUserVerified(assertion.authenticatorData, request.rpId);
  const blob = toBytes(assertion.extensionResults.largeBlob?.blob);
  if (!blob || blob.length === 0) {
    throw new WebAuthnUnavailableError("authenticator returned no largeBlob");
  }
  return parseDeviceKeyEnvelope(blob);
}
