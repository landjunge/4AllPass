/** Last vault this window opened. Survives a restart so list order cannot steal it. */

const KEY = "4allpass.active-vault";

export function readActiveVaultId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeActiveVaultId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* WKWebView storage can throw */
  }
}
