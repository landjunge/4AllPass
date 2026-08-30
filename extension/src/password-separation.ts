/** Account password is sent to the server. Vault password must not be the same. */

export const SAME_PASSWORD_ERROR =
  "Konto-Passwort und Tresor-Passwort müssen verschieden sein. Der Server sieht das Konto-Passwort. / Account password and vault password must differ. The server sees the account password.";

export function passwordsAreSame(accountPassword: string, vaultPassword: string): boolean {
  const account = accountPassword.trim();
  const vault = vaultPassword.trim();
  if (!account || !vault) return false;
  return account === vault;
}
