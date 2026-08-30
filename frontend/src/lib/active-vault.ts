/**
 * Last vault this window opened. Survives a restart so list order cannot steal it.
 * The id is a server UUID, not a wrapping key or password.
 */

const KEY = "4allpass.active-vault";
const VAULT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asVaultId(value: string | null | undefined): string | null {
  if (!value) return null;
  return VAULT_ID.exec(value)?.[0] ?? null;
}

export function readActiveVaultId(): string | null {
  try {
    return asVaultId(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeActiveVaultId(id: string | null): void {
  try {
    const vaultId = asVaultId(id);
    if (vaultId) localStorage.setItem(KEY, vaultId);
    else localStorage.removeItem(KEY);
  } catch {
    /* WKWebView storage can throw */
  }
}
