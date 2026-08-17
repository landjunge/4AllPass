/**
 * Fallback hierarchy per docs/webauthn-prf.md §5. Each rank is a lower
 * security level; Master Password unlock must always remain possible and is
 * therefore not part of this ranking — it is the floor underneath it.
 *
 *   1. prf              — cryptographic bind to the authenticator
 *   2. large_blob       — Device-Key Envelope held by the authenticator
 *   3. uv_gated_local   — policy gate only (documented to the user)
 */

export type UnlockMechanism = "prf" | "large_blob" | "uv_gated_local";

export interface UnlockCapability {
  mechanism: UnlockMechanism;
  /** Rank 3 has no cryptographic bind; the UI must say so. */
  cryptographicBind: boolean;
}

interface CreateExtensionResults {
  prf?: { enabled?: boolean };
  largeBlob?: { supported?: boolean };
}

/**
 * Classify a freshly created credential by its client extension results.
 * Absence of PRF is a fallback, not a hard error (§7).
 */
export function classifyCredential(
  extensionResults: CreateExtensionResults,
): UnlockCapability {
  if (extensionResults.prf?.enabled === true) {
    return { mechanism: "prf", cryptographicBind: true };
  }
  if (extensionResults.largeBlob?.supported === true) {
    return { mechanism: "large_blob", cryptographicBind: true };
  }
  return { mechanism: "uv_gated_local", cryptographicBind: false };
}

export function isWebAuthnAvailable(): boolean {
  return typeof navigator !== "undefined" && "credentials" in navigator
    && typeof PublicKeyCredential !== "undefined";
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function describeMechanism(capability: UnlockCapability): string {
  switch (capability.mechanism) {
    case "prf":
      return "WebAuthn PRF – kryptografisch an den Authenticator gebunden";
    case "large_blob":
      return "WebAuthn largeBlob – Device-Key-Envelope liegt im Authenticator";
    case "uv_gated_local":
      return "UV-gated local store – nur Policy-Schutz, keine kryptografische Bindung";
  }
}
