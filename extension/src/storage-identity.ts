/**
 * Desktop and the extension must use the same storage user.
 * Silent POST /auth/local is only for a Mac that has no e-mail account.
 */

export const ACCOUNT_REQUIRED_ERROR =
  "Dieses Gerät hat ein Konto. Dieselbe E-Mail und dasselbe Konto-Passwort wie in der App. / This device has an account. Use the same e-mail and account password as the app.";

export function mustUseAccountLogin(status: { hasOtherAccounts?: unknown } | null | undefined): boolean {
  return status?.hasOtherAccounts === true;
}

export function assertAccountIfNeeded(
  status: { hasOtherAccounts?: unknown } | null | undefined,
  email: string,
  accountPassword: string,
): void {
  if (mustUseAccountLogin(status) && (!email.trim() || !accountPassword)) {
    throw new Error(ACCOUNT_REQUIRED_ERROR);
  }
}

export function pickVaultId(
  vaults: ReadonlyArray<{ vaultId: string }>,
  preferred: string | null | undefined,
): string | null {
  if (preferred && vaults.some((row) => row.vaultId === preferred)) return preferred;
  return vaults[0]?.vaultId ?? null;
}
