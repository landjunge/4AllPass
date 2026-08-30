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

export type FieldRole = "username" | "email" | "password" | "otp";

export interface ScoredField {
  input: InputLike;
  role: FieldRole;
  confidence: number;
  reasons: string[];
}

export interface LoginModel {
  username: ScoredField | null;
  password: ScoredField | null;
  otp: ScoredField | null;
  confidence: number;
  eligible: boolean;
}

export type FillMode = "native" | "controlled" | "failed" | "skipped";

export type FillReason =
  | "locked"
  | "low-confidence"
  | "no-match"
  | "no-fields"
  | "verify-mismatch"
  | "signup"
  | "origin-mismatch";

export interface FillResult {
  ok: boolean;
  /** Origin the content script actually ran in. Never a secret. */
  pageOrigin?: string;
  /** Fields the model recognized (never values). */
  fields: Array<"username" | "password" | "otp">;
  /** Fields whose DOM value matched after Safe Fill. */
  filled?: Array<"username" | "password" | "otp">;
  /** Sub-threshold fields the user may fill after an explicit Assist click. */
  assistFields?: Array<"username" | "password">;
  /** Machine-readable score reasons. Never page values or secrets. */
  hints?: string[];
  /** Field name/id for detection. Never values. */
  fieldNames?: string[];
  /** Visible labels for detection. Never values. */
  fieldLabels?: string[];
  mode: FillMode;
  reason?: FillReason;
  confidence?: number;
}

/** Path is a registration funnel (Netflix /signup), not a login. */
export function isSignupPath(pathname: string): boolean {
  const path = pathname.split("?")[0]?.toLowerCase() ?? "";
  return /\/(signup|sign-up|register|registration|join)(\/|$)/.test(path);
}

/** Signup: new-password present, no current-password. Do not fill as login. */
export function isSignupForm(inputs: InputLike[]): boolean {
  const autos = (input: InputLike) => input.autocomplete.toLowerCase();
  const hasNew = inputs.some(
    (input) => input.type === "password" && autos(input).includes("new-password"),
  );
  const hasCurrent = inputs.some(
    (input) => input.type === "password" && autos(input).includes("current-password"),
  );
  return hasNew && !hasCurrent;
}

export function ineligibleReason(inputs: InputLike[], model: LoginModel): FillReason {
  if (inputs.length === 0) return "no-fields";
  if (isSignupForm(inputs)) return "signup";
  if (!model.eligible) return "low-confidence";
  return "no-fields";
}

export function fillErrorMessage(reason: FillReason | undefined): string {
  switch (reason) {
    case "locked":
      return "Tresor gesperrt / vault is locked";
    case "no-match":
      return "Kein Eintrag zu dieser Seite / no entry matches this page";
    case "low-confidence":
      return "Login-Felder unsicher / login fields not confident enough";
    case "signup":
      return "Sieht nach Registrierung aus — Login-Seite öffnen / this looks like a sign-up form, open the login page";
    case "verify-mismatch":
      return "Seite hat Fill nicht übernommen / page did not accept the fill";
    case "origin-mismatch":
      return "Seite hat gewechselt / page origin changed";
    case "no-fields":
    default:
      return "Keine Login-Felder / no login fields on this page";
  }
}

/** Human line for a miss — erkannt / gefüllt / Ergebnis, never secrets. */
export function formatFillFailure(result: {
  reason?: FillReason;
  fields?: Array<"username" | "password" | "otp">;
  filled?: Array<"username" | "password" | "otp">;
  mode?: FillMode;
  confidence?: number;
}): string {
  const bits = [fillErrorMessage(result.reason)];
  bits.push(`Erkannt / recognized ${result.fields?.length ? result.fields.join("+") : "—"}`);
  bits.push(`Gefüllt / filled ${result.filled?.length ? result.filled.join("+") : "—"}`);
  bits.push(`Ergebnis / result ${result.reason ?? "unknown"}`);
  if (result.mode && result.mode !== "skipped") bits.push(result.mode);
  if (typeof result.confidence === "number" && result.confidence > 0) {
    bits.push(`${Math.round(result.confidence * 100)}%`);
  }
  return bits.join(" · ");
}

export function formatFillSuccess(result: {
  fields?: Array<"username" | "password" | "otp">;
  mode?: FillMode;
  confidence?: number;
}): string {
  const bits = ["Gefüllt / Filled"];
  if (result.fields?.length) bits.push(result.fields.join("+"));
  if (result.mode && result.mode !== "skipped") bits.push(result.mode);
  if (typeof result.confidence === "number" && result.confidence > 0) {
    bits.push(`${Math.round(result.confidence * 100)}%`);
  }
  return bits.join(" · ");
}

export function leftoverAssistFields(
  strict: LoginModel,
  weak: LoginModel,
): Array<"username" | "password"> {
  const extra: Array<"username" | "password"> = [];
  if (weak.username && !strict.username) extra.push("username");
  if (weak.password && !strict.password) extra.push("password");
  return extra;
}

/** Assist only when a password field exists — never a lone search box. */
export function shouldOfferAssist(inputs: InputLike[]): boolean {
  const strict = buildLoginModel(inputs);
  if (ineligibleReason(inputs, strict) === "signup") return false;
  const weak = buildLoginModel(inputs, 0);
  if (!strict.password && !weak.password) return false;
  return leftoverAssistFields(strict, weak).length > 0;
}

export function formatAssistPrompt(fields: Array<"username" | "password">): string {
  const names = fields.join("+") || "—";
  return `Unsicher / low confidence (${names}) — trotzdem füllen? / fill anyway?`;
}

export function modelHints(model: LoginModel): string[] {
  return [
    ...(model.username?.reasons ?? []),
    ...(model.password?.reasons ?? []),
    ...(model.otp?.reasons ?? []),
  ];
}

export function probeFromModel(inputs: InputLike[], model: LoginModel): FillResult {
  const fields: Array<"username" | "password" | "otp"> = [];
  if (model.username) fields.push("username");
  if (model.password) fields.push("password");
  if (model.otp) fields.push("otp");
  const weak = buildLoginModel(inputs, 0);
  const assistFields = shouldOfferAssist(inputs) ? leftoverAssistFields(model, weak) : [];
  if (!model.eligible) {
    return {
      ok: false,
      fields,
      filled: [],
      assistFields,
      hints: modelHints(weak),
      mode: "skipped",
      reason: ineligibleReason(inputs, model),
      confidence: model.confidence,
    };
  }
  return {
    ok: true,
    fields,
    filled: [],
    assistFields,
    hints: modelHints(model),
    mode: "skipped",
    confidence: model.confidence,
  };
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
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
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

  if (
    fields.includes("new-password") ||
    /\b(new|confirm|repeat|retype|newpassword)\b/.test(text)
  ) {
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

export function scoreOtp(input: InputLike): ScoredField | null {
  if (!isUsable(input) || input.type === "password" || input.type === "hidden") return null;
  const autos = autoTokens(input);
  if (autos.includes("one-time-code")) {
    return { input, role: "otp", confidence: 0.98, reasons: ["autocomplete=one-time-code"] };
  }
  const text = textSignals(input);
  if (/\b(otp|totp|2fa|one time code|one-time)\b/.test(text)) {
    return { input, role: "otp", confidence: 0.85, reasons: ["name/id/label≈otp"] };
  }
  return null;
}

export function buildLoginModel(
  inputs: InputLike[],
  threshold = FILL_CONFIDENCE_THRESHOLD,
): LoginModel {
  const usernameRaw = bestOf(inputs.map(scoreUsername).filter((s): s is ScoredField => s !== null));
  const passwordRaw = bestOf(inputs.map(scorePassword).filter((s): s is ScoredField => s !== null));
  const otpRaw = bestOf(inputs.map(scoreOtp).filter((s): s is ScoredField => s !== null));

  const username = usernameRaw && usernameRaw.confidence >= threshold ? usernameRaw : null;
  const password = passwordRaw && passwordRaw.confidence >= threshold ? passwordRaw : null;
  const otp = otpRaw && otpRaw.confidence >= threshold ? otpRaw : null;

  let confidence = 0;
  if (username && password) confidence = Math.min(username.confidence, password.confidence);
  else if (username) confidence = username.confidence;
  else if (password) confidence = password.confidence;
  else if (otp) confidence = otp.confidence;

  const signup = isSignupForm(inputs);
  return {
    username,
    password,
    otp,
    confidence,
    eligible: !signup && confidence >= threshold && Boolean(username || password || otp),
  };
}

export function pickUsername(inputs: InputLike[]): InputLike | null {
  return buildLoginModel(inputs, 0).username?.input ?? null;
}

export function pickPassword(inputs: InputLike[]): InputLike | null {
  return buildLoginModel(inputs, 0).password?.input ?? null;
}
