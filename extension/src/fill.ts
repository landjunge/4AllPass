/** DOM-free field intelligence. Content script maps real inputs onto this. */

export const FILL_CONFIDENCE_THRESHOLD = 0.7;

export interface InputLike {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder?: string;
  ariaLabel?: string;
  labelText?: string;
  readonly?: boolean;
  disabled?: boolean;
}

export type FieldRole = "username" | "email" | "password";

export interface ScoredField {
  input: InputLike;
  role: FieldRole;
  confidence: number;
  reasons: string[];
}

export interface LoginModel {
  username: ScoredField | null;
  password: ScoredField | null;
  confidence: number;
  eligible: boolean;
}

const CONTEXT_TOKENS = new Set([
  "shipping",
  "billing",
  "home",
  "work",
  "mobile",
  "fax",
  "pager",
  "webauthn",
  "on",
  "off",
]);

const USERNAME_SKIP = new Set([
  "name",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-prefix",
  "honorific-suffix",
  "nickname",
  "organization",
  "organization-title",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level1",
  "address-level2",
  "address-level3",
  "address-level4",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "url",
  "photo",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
  "impp",
  "one-time-code",
  "new-password",
  "current-password",
]);

function autoTokens(input: InputLike): string[] {
  return input.autocomplete
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
}

function fieldTokens(input: InputLike): string[] {
  return autoTokens(input).filter(
    (token) => !token.startsWith("section-") && !CONTEXT_TOKENS.has(token),
  );
}

function textSignals(input: InputLike): string {
  return [input.name, input.id, input.placeholder ?? "", input.ariaLabel ?? "", input.labelText ?? ""]
    .join(" ")
    .toLowerCase();
}

function isUsable(input: InputLike): boolean {
  return !input.readonly && !input.disabled;
}

function bestOf(fields: ScoredField[]): ScoredField | null {
  if (fields.length === 0) return null;
  return [...fields].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

export function scoreUsername(input: InputLike): ScoredField | null {
  if (!isUsable(input) || input.type === "password" || input.type === "hidden") {
    return null;
  }

  const fields = fieldTokens(input);
  const skip = fields.find(
    (token) =>
      USERNAME_SKIP.has(token) ||
      token.startsWith("cc-") ||
      token.startsWith("address-") ||
      token.startsWith("tel-"),
  );
  if (skip) return null;

  const reasons: string[] = [];
  let confidence = 0;
  let role: FieldRole = "username";

  if (fields.includes("username")) {
    return { input, role: "username", confidence: 0.98, reasons: ["autocomplete=username"] };
  }
  if (fields.includes("email")) {
    return { input, role: "email", confidence: 0.96, reasons: ["autocomplete=email"] };
  }

  if (input.type === "email") {
    confidence = 0.9;
    role = "email";
    reasons.push("type=email");
  }

  const text = textSignals(input);
  if (/\b(user(name)?|login|acct|account)\b/.test(text)) {
    if (0.82 > confidence) {
      confidence = 0.82;
      role = "username";
      reasons.push("name/id/label≈username");
    }
  } else if (/\b(e-?mail|mail)\b/.test(text)) {
    if (0.8 > confidence) {
      confidence = 0.8;
      role = "email";
      reasons.push("name/id/label≈email");
    }
  }

  if (confidence === 0 && (input.type === "text" || input.type === "tel" || input.type === "")) {
    confidence = 0.45;
    reasons.push("weak-text-fallback");
  }

  if (confidence === 0) return null;
  return { input, role, confidence, reasons };
}

export function scorePassword(input: InputLike): ScoredField | null {
  if (!isUsable(input) || input.type !== "password") {
    return null;
  }

  const fields = fieldTokens(input);
  const text = textSignals(input);

  if (fields.includes("new-password") || /\b(new|confirm|repeat|retype)\b/.test(text)) {
    return null;
  }
  if (fields.includes("one-time-code")) {
    return null;
  }

  if (fields.includes("current-password")) {
    return { input, role: "password", confidence: 0.98, reasons: ["autocomplete=current-password"] };
  }
  if (fields.includes("password")) {
    return { input, role: "password", confidence: 0.92, reasons: ["autocomplete=password"] };
  }
  if (/\b(pass(word)?|pwd|passwd)\b/.test(text)) {
    return { input, role: "password", confidence: 0.8, reasons: ["name/id/label≈password"] };
  }

  return { input, role: "password", confidence: 0.72, reasons: ["type=password"] };
}

export function buildLoginModel(
  inputs: InputLike[],
  threshold = FILL_CONFIDENCE_THRESHOLD,
): LoginModel {
  const usernameRaw = bestOf(inputs.map(scoreUsername).filter((s): s is ScoredField => s !== null));
  const passwordRaw = bestOf(inputs.map(scorePassword).filter((s): s is ScoredField => s !== null));

  const username = usernameRaw && usernameRaw.confidence >= threshold ? usernameRaw : null;
  const password = passwordRaw && passwordRaw.confidence >= threshold ? passwordRaw : null;

  let confidence = 0;
  if (username && password) confidence = Math.min(username.confidence, password.confidence);
  else if (username) confidence = username.confidence;
  else if (password) confidence = password.confidence;

  return {
    username,
    password,
    confidence,
    eligible: confidence >= threshold && Boolean(username || password),
  };
}

export function pickUsername(inputs: InputLike[]): InputLike | null {
  return buildLoginModel(inputs, 0).username?.input ?? null;
}

export function pickPassword(inputs: InputLike[]): InputLike | null {
  return buildLoginModel(inputs, 0).password?.input ?? null;
}
