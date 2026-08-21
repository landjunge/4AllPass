/**
 * Best-effort feature detection. Actual PRF support can only be confirmed
 * per-credential at registration/assertion time (webauthn-prf.md §7:
 * "Treat absence as fallback, not as a hard error").
 */

export interface WebviewWebauthnCaps {
  publicKeyCredential: boolean;
  credentialsCreate: boolean;
  platformAuthenticator: boolean | null;
  prf: boolean | null;
}

export function webauthnPrfAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
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
