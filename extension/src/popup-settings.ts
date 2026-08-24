export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8788";
export const POPUP_SETTINGS_KEY = "popupSettings";

export interface PopupSettings {
  apiOrigin: string;
  email: string;
}

export function normalizeApiOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed || DEFAULT_API_ORIGIN;
}

export function parsePopupSettings(value: unknown): PopupSettings {
  if (!value || typeof value !== "object") {
    return { apiOrigin: DEFAULT_API_ORIGIN, email: "" };
  }
  const row = value as Record<string, unknown>;
  const email = typeof row.email === "string" ? row.email.trim() : "";
  const apiOrigin = typeof row.apiOrigin === "string" ? normalizeApiOrigin(row.apiOrigin) : DEFAULT_API_ORIGIN;
  return { apiOrigin, email };
}

/** Never persist vault or account passwords. */
export function popupSettingsForStore(apiOrigin: string, email: string): PopupSettings {
  return {
    apiOrigin: normalizeApiOrigin(apiOrigin),
    email: email.trim(),
  };
}
