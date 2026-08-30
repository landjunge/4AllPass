/**
 * Account password is sent to the server. Vault password must not be the same.
 * Exact match after trim. No unicode folding — that would hide lookalikes.
 */

export const SAME_PASSWORD_ERROR =
  "Konto-Passwort und Tresor-Passwort müssen verschieden sein. Der Server sieht das Konto-Passwort. / Account password and vault password must differ. The server sees the account password.";

export const SAME_PASSWORD_NOTICE =
  "Konto- und Tresor-Passwort sind gleich. Ein Server, der das Konto-Passwort sieht, kann den Tresor öffnen. Ändere eines. / Account and vault passwords are the same. A server that sees the account password can open the vault. Change one.";

export function passwordsAreSame(accountPassword: string, vaultPassword: string): boolean {
  const account = accountPassword.trim();
  const vault = vaultPassword.trim();
  if (!account || !vault) return false;
  return account === vault;
}
