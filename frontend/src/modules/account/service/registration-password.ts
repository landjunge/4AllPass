import { feedbackError } from "../../feedback/index.ts";

// Account registration only. Count Unicode code points, not UTF-16 units.
// Keep the existing 256-codepoint backend ceiling; never truncate or normalize.
export function checkRegistrationPasswordLength(password: string): void {
  const length = Array.from(password).length;
  if (length < 15) throw feedbackError("account_password_too_short");
  if (length > 256) throw feedbackError("account_password_too_long");
}
