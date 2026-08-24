/**
 * Best-effort feature detection. Actual PRF support can only be confirmed
 * per-credential at registration/assertion time (webauthn-prf.md §7:
 * "Treat absence as fallback, not as a hard error").
 *
 * `PublicKeyCredential` existing is not PRF. Desktop WKWebView reports the
 * WebAuthn API and still returns `prf: null`.
 */

export interface WebviewWebauthnCaps {
  publicKeyCredential: boolean;
  credentialsCreate: boolean;
  platformAuthenticator: boolean | null;
  prf: boolean | null;
}

export type PrfCapabilityState = "available" | "unavailable" | "unconfirmed";

/** WebAuthn API objects exist. This is not a PRF proof. */
export function webauthnApiPresent(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
}

/** Classify a probe. `true` only when the client reported the PRF extension. */
export function prfCapabilityState(caps: WebviewWebauthnCaps): PrfCapabilityState {
  if (caps.prf === true) return "available";
  if (caps.prf === false || !caps.publicKeyCredential || !caps.credentialsCreate) {
    return "unavailable";
  }
  return "unconfirmed";
}

export function isTauriShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function probeWebviewWebauthn(): Promise<WebviewWebauthnCaps> {
  const publicKeyCredential = typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
  const credentialsCreate = Boolean(navigator.credentials && navigator.credentials.create);
  let platformAuthenticator: boolean | null = null;
  let prf: boolean | null = null;
  if (publicKeyCredential) {
    const pk = window.PublicKeyCredential;
    try {
      if (typeof pk.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
        platformAuthenticator = await pk.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch {
      platformAuthenticator = null;
    }
    const getCaps = (pk as unknown as { getClientCapabilities?: () => Promise<Record<string, unknown>> })
      .getClientCapabilities;
    if (typeof getCaps === "function") {
      try {
        const caps = await getCaps.call(pk);
        const ext = caps.extensions;
        if (Array.isArray(ext)) prf = ext.includes("prf");
        else if (typeof caps.prf === "boolean") prf = caps.prf;
        else if (caps && typeof caps === "object" && "extension:prf" in caps) {
          prf = Boolean((caps as Record<string, unknown>)["extension:prf"]);
        }
      } catch {
        prf = null;
      }
    }
  }
  return { publicKeyCredential, credentialsCreate, platformAuthenticator, prf };
}
