import type { Line } from "../../../lib/copy-mode.ts";

export type FeedbackErrorCode =
  | "account_password_too_short"
  | "account_password_too_long"
  | "account_password_blocklisted"
  | "account_password_invalid"
  | "authentication_failed"
  | "conflict"
  | "device_unlock_unavailable"
  | "empty_share"
  | "integrity_failed"
  | "invalid_request"
  | "network_unavailable"
  | "no_other_vault"
  | "no_vault_selected"
  | "not_found"
  | "not_signed_in"
  | "passwords_must_differ"
  | "permission_denied"
  | "protocol_error"
  | "rollback_detected"
  | "service_unavailable"
  | "unexpected"
  | "vault_locked";

export interface TechnicalCause {
  /** Safe classification only. Never copy Error.message, response bodies, or identifiers here. */
  name: string;
  status?: number;
}

export interface ErrorFeedback {
  kind: "error";
  code: FeedbackErrorCode;
  userText: Line;
  technical: TechnicalCause;
}

const ERROR_TEXT: Record<FeedbackErrorCode, Line> = {
  account_password_too_short: {
    de: "Das neue Konto-Passwort braucht mindestens 15 Zeichen. Wähle ein längeres Passwort.",
    en: "A new account password needs at least 15 characters. Choose a longer password.",
  },
  account_password_too_long: {
    de: "Das Konto-Passwort darf höchstens 256 Zeichen haben. Es wurde nichts gekürzt.",
    en: "The account password can contain at most 256 characters. Nothing was truncated.",
  },
  account_password_blocklisted: {
    de: "Dieses Konto-Passwort ist zu leicht zu erraten oder als unsicher bekannt. Wähle ein anderes, langes Passwort oder lass eines erzeugen; ändere nicht nur ein Zeichen.",
    en: "This account password is easy to guess or known to be unsafe. Choose a different, long password or generate one; do not just change one character.",
  },
  account_password_invalid: {
    de: "Das Konto-Passwort konnte nicht gelesen werden. Bitte neu eingeben oder ein anderes Passwort erzeugen.",
    en: "The account password could not be read. Enter it again or generate a different password.",
  },
  authentication_failed: {
    de: "Anmeldung, Passwort oder Schlüssel stimmt nicht. Bitte erneut versuchen.",
    en: "Sign-in, password, or key did not match. Please try again.",
  },
  conflict: {
    de: "Der Tresor wurde inzwischen geändert. Bitte neu laden und erneut versuchen.",
    en: "The vault changed in the meantime. Reload and try again.",
  },
  device_unlock_unavailable: {
    de: "Geräte-Entsperren ist hier nicht verfügbar. Bitte das Tresor-Passwort verwenden.",
    en: "Device unlock is not available here. Use the vault password instead.",
  },
  empty_share: {
    de: "Die Share-Datei enthält keine Einträge.",
    en: "The share file contains no entries.",
  },
  integrity_failed: {
    de: "Die Tresordaten konnten nicht sicher geprüft werden. Nichts wurde geöffnet.",
    en: "The vault data could not be verified safely. Nothing was opened.",
  },
  invalid_request: {
    de: "Die Eingaben konnten nicht verarbeitet werden. Bitte prüfen und erneut versuchen.",
    en: "The input could not be processed. Check it and try again.",
  },
  network_unavailable: {
    de: "4AllPass kann den lokalen Dienst gerade nicht erreichen. Bitte kurz warten und erneut versuchen.",
    en: "4AllPass cannot reach the local service right now. Wait a moment and try again.",
  },
  no_other_vault: {
    de: "Auf diesem Mac wurde kein anderer Tresor gefunden.",
    en: "No other vault was found on this Mac.",
  },
  no_vault_selected: {
    de: "Bitte zuerst einen Tresor auswählen.",
    en: "Select a vault first.",
  },
  not_found: {
    de: "Der angeforderte Inhalt wurde nicht gefunden.",
    en: "The requested item was not found.",
  },
  not_signed_in: {
    de: "Bitte zuerst anmelden.",
    en: "Sign in first.",
  },
  passwords_must_differ: {
    de: "Konto-Passwort und Tresor-Passwort müssen verschieden sein. Der Server sieht das Konto-Passwort.",
    en: "Account password and vault password must differ. The server sees the account password.",
  },
  permission_denied: {
    de: "Diese Aktion ist nicht erlaubt.",
    en: "This action is not allowed.",
  },
  protocol_error: {
    de: "Diese Tresordaten werden von dieser 4AllPass-Version nicht unterstützt.",
    en: "This vault data is not supported by this version of 4AllPass.",
  },
  rollback_detected: {
    de: "Ein älterer Tresorstand wurde erkannt und aus Sicherheitsgründen nicht geöffnet.",
    en: "An older vault state was detected and was not opened for safety.",
  },
  service_unavailable: {
    de: "4AllPass konnte die Aktion gerade nicht abschließen. Bitte erneut versuchen.",
    en: "4AllPass could not finish the action right now. Please try again.",
  },
  unexpected: {
    de: "Etwas hat nicht funktioniert. Es wurden keine technischen Details angezeigt. Bitte erneut versuchen.",
    en: "Something did not work. No technical details were shown. Please try again.",
  },
  vault_locked: {
    de: "Der Tresor ist gesperrt. Bitte zuerst öffnen.",
    en: "The vault is locked. Open it first.",
  },
};

export class UserFeedbackError extends Error {
  readonly feedbackCode: FeedbackErrorCode;

  constructor(code: FeedbackErrorCode) {
    super(code);
    this.name = "UserFeedbackError";
    this.feedbackCode = code;
  }
}

export function feedbackError(code: FeedbackErrorCode): UserFeedbackError {
  return new UserFeedbackError(code);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  switch (error.name) {
    case "ApiError":
    case "AuthFailureError":
    case "CommitConflict":
    case "DeviceUnlockNotPossible":
    case "IntegrityError":
    case "NotAllowedError":
    case "ProtocolError":
    case "RollbackError":
    case "TypeError":
    case "UserFeedbackError":
      return error.name;
    default:
      return "UnknownError";
  }
}

function classify(error: unknown, status: number | undefined): FeedbackErrorCode {
  if (error instanceof UserFeedbackError) return error.feedbackCode;
  if (status === 422 && errorName(error) === "ApiError" && "body" in (error as object)) {
    const body = (error as { body?: unknown }).body;
    const detail = body && typeof body === "object" && "detail" in body
      ? (body as { detail?: unknown }).detail : undefined;
    switch (detail) {
      case "account_password_too_short":
      case "account_password_too_long":
      case "account_password_blocklisted":
      case "account_password_invalid":
        return detail;
    }
  }
  if (status === 401) return "authentication_failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid_request";
  if (status !== undefined && status >= 500) return "service_unavailable";

  switch (errorName(error)) {
    case "AuthFailureError":
      return "authentication_failed";
    case "CommitConflict":
      return "conflict";
    case "DeviceUnlockNotPossible":
    case "NotAllowedError":
      return "device_unlock_unavailable";
    case "IntegrityError":
      return "integrity_failed";
    case "ProtocolError":
      return "protocol_error";
    case "RollbackError":
      return "rollback_detected";
    case "TypeError":
      return "network_unavailable";
    default:
      return "unexpected";
  }
}

export function describeError(error: unknown): ErrorFeedback {
  const status = errorStatus(error);
  const code = classify(error, status);
  return {
    kind: "error",
    code,
    userText: ERROR_TEXT[code],
    technical: {
      name: errorName(error),
      ...(status === undefined ? {} : { status }),
    },
  };
}
