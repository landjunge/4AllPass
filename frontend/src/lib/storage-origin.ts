/** Where sealed snapshots live. Not a crypto factor. Never store passwords here. */

export const STORAGE_ORIGIN_KEY = "4allpass.storage-origin";

function isLoopbackHostname(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

/**
 * HTTP only on loopback. Anything else must be HTTPS.
 * The account password travels here; the vault password does not.
 */
export function normalizeStorageOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Storage origin must be an absolute http(s) URL");
  }
  if (url.username || url.password) {
    throw new Error("Storage origin must not include credentials");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Storage origin is the host only, no path");
  }
  if (url.protocol === "https:") return trimmed;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return trimmed;
  throw new Error("Storage origin must use HTTPS (HTTP is only allowed on loopback)");
}

export function readStorageOrigin(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_ORIGIN_KEY);
    if (!raw) return null;
    const origin = normalizeStorageOrigin(raw);
    return origin || null;
  } catch {
    return null;
  }
}

export function writeStorageOrigin(raw: string | null): string | null {
  const origin = raw ? normalizeStorageOrigin(raw) : "";
  try {
    if (origin) localStorage.setItem(STORAGE_ORIGIN_KEY, origin);
    else localStorage.removeItem(STORAGE_ORIGIN_KEY);
  } catch {
    /* WKWebView storage can throw */
  }
  return origin || null;
}
