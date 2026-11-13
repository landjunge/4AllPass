/**
 * One shared vault-master policy for create and recovery-continuation. This is
 * the vault password, not the account password; account rules stay separate.
 */
export const MASTER_PASSWORD_MIN_LENGTH = 10;

export function assertMasterPassword(password: string): void {
  if (typeof password !== "string" || password.length < MASTER_PASSWORD_MIN_LENGTH) {
    throw new Error(`master password needs at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
  }
}
