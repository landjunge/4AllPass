/**
 * Local length/class heuristic for UI. Not a cryptographic claim and not
 * sent anywhere. Empty secrets are not scored.
 */
export type PasswordStrength = "empty" | "weak" | "ok" | "strong";

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return "empty";
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/\d/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  if (password.length < 10 || classes < 2) return "weak";
  if (password.length >= 16 && classes >= 3) return "strong";
  return "ok";
}

export function isWeakPassword(password: string): boolean {
  return passwordStrength(password) === "weak";
}

export function countWeakSecrets(passwords: readonly string[]): number {
  return passwords.filter(isWeakPassword).length;
}
