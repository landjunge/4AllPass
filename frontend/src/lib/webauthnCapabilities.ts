/**
 * Best-effort feature detection. Actual PRF support can only be confirmed
 * per-credential at registration/assertion time (webauthn-prf.md §7:
 * "Treat absence as fallback, not as a hard error").
 */
export function webauthnPrfAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  )
}
