/**
 * Account password is sent to the server. Vault password must not be the same.
 * Exact match after trim. No unicode folding — that would hide lookalikes.
 */

export function passwordsAreSame(accountPassword: string, vaultPassword: string): boolean {
  const account = accountPassword.trim();
  const vault = vaultPassword.trim();
  if (!account || !vault) return false;
  return account === vault;
}
