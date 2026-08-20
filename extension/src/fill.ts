/** DOM-free field picking. Content script maps real inputs onto this. */

export interface InputLike {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
}

function tokens(input: InputLike): string {
  return `${input.autocomplete} ${input.name} ${input.id}`.toLowerCase();
}

function autoTokens(input: InputLike): string[] {
  return input.autocomplete.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

export function pickUsername(inputs: InputLike[]): InputLike | null {
  const candidates = inputs.filter((input) => input.type !== "password");
  const byAuto = candidates.find((input) =>
    autoTokens(input).some((token) => token === "username" || token === "email"),
  );
  if (byAuto) return byAuto;
  const named = candidates.find((input) => /user|email|login/.test(tokens(input)));
  return named ?? candidates[0] ?? null;
}

export function pickPassword(inputs: InputLike[]): InputLike | null {
  const passwords = inputs.filter((input) => input.type === "password");
  const current = passwords.find((input) => input.autocomplete.toLowerCase().includes("current-password"));
  if (current) return current;
  const rest = passwords.filter((input) => !input.autocomplete.toLowerCase().includes("new-password"));
  return rest[0] ?? null;
}
