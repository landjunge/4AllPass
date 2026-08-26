export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8788";
export const POPUP_SETTINGS_KEY = "popupSettings";

export interface PopupSettings {
  apiOrigin: string;
  email: string;
}

function isLoopbackHostname(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

/**
 * HTTP only on loopback. Anything else must be HTTPS.
 * Account password travels on this origin during server login.
 */
export function normalizeApiOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return DEFAULT_API_ORIGIN;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API origin must be an absolute http(s) URL");
  }
  if (url.username || url.password) {
    throw new Error("API origin must not include credentials");
  }
  if (url.protocol === "https:") {
    return trimmed;
  }
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return trimmed;
  }
  throw new Error("API origin must use HTTPS (HTTP is only allowed on loopback)");
}

export function parsePopupSettings(value: unknown): PopupSettings {
  if (!value || typeof value !== "object") {
    return { apiOrigin: DEFAULT_API_ORIGIN, email: "" };
  }
  const row = value as Record<string, unknown>;
  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (typeof row.apiOrigin !== "string") {
    return { apiOrigin: DEFAULT_API_ORIGIN, email };
  }
  try {
    return { apiOrigin: normalizeApiOrigin(row.apiOrigin), email };
  } catch {
    return { apiOrigin: DEFAULT_API_ORIGIN, email };
  }
}

/** Never persist vault or account passwords. */
export function popupSettingsForStore(apiOrigin: string, email: string): PopupSettings {
  return {
    apiOrigin: normalizeApiOrigin(apiOrigin),
    email: email.trim(),
  };
}
