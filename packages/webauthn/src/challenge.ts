/**
 * One server-issued challenge per WebAuthn ceremony (webauthn-prf.md §2.4).
 *
 * Tests omit the provider and fall back to `newChallenge()`. The PWA must
 * supply a provider that talks to POST /webauthn/challenges.
 */
import { randomBytes } from "@4allpass/crypto";

export const CHALLENGE_BYTES = 32;

export type CeremonyPurpose = "create" | "assert";

export interface CeremonyArtifact {
  purpose: CeremonyPurpose;
  credentialId: Uint8Array;
  clientDataJSON: ArrayBuffer;
  attestationObject?: ArrayBuffer;
  authenticatorData?: ArrayBuffer;
  signature?: ArrayBuffer;
}

export interface ChallengeProvider {
  /** Called immediately before every navigator.credentials.create / .get. */
  next(purpose: CeremonyPurpose): Promise<Uint8Array>;
  /** Optional: PWA reports the authenticator response so the server can verify COSE. */
  report?(artifact: CeremonyArtifact): void;
}

export function reportCeremony(
  provider: ChallengeProvider | undefined,
  artifact: CeremonyArtifact,
): void {
  provider?.report?.(artifact);
}

export function newChallenge(): Uint8Array {
  return randomBytes(CHALLENGE_BYTES);
}

export async function resolveChallenge(
  purpose: CeremonyPurpose,
  provider?: ChallengeProvider | undefined,
): Promise<Uint8Array> {
  if (provider) {
    const challenge = await provider.next(purpose);
    if (!(challenge instanceof Uint8Array) || challenge.length !== CHALLENGE_BYTES) {
      throw new Error(`server challenge must be ${CHALLENGE_BYTES} bytes`);
    }
    return challenge;
  }
  return newChallenge();
}
