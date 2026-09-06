export type FeedbackErrorCode =
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
  userText: string;
  technical: TechnicalCause;
}

const ERROR_TEXT: Record<FeedbackErrorCode, string> = {
  authentication_failed:
    "Anmeldung, Passwort oder Schlüssel stimmt nicht. Bitte erneut versuchen. / Sign-in, password, or key did not match. Please try again.",
  conflict:
    "Der Tresor wurde inzwischen geändert. Bitte neu laden und erneut versuchen. / The vault changed in the meantime. Reload and try again.",
  device_unlock_unavailable:
    "Geräte-Entsperren ist hier nicht verfügbar. Bitte das Tresor-Passwort verwenden. / Device unlock is not available here. Use the vault password instead.",
  empty_share:
    "Die Share-Datei enthält keine Einträge. / The share file contains no entries.",
  integrity_failed:
    "Die Tresordaten konnten nicht sicher geprüft werden. Nichts wurde geöffnet. / The vault data could not be verified safely. Nothing was opened.",
  invalid_request:
    "Die Eingaben konnten nicht verarbeitet werden. Bitte prüfen und erneut versuchen. / The input could not be processed. Check it and try again.",
  network_unavailable:
    "4AllPass kann den lokalen Dienst gerade nicht erreichen. Bitte kurz warten und erneut versuchen. / 4AllPass cannot reach the local service right now. Wait a moment and try again.",
  no_other_vault:
    "Auf diesem Mac wurde kein anderer Tresor gefunden. / No other vault was found on this Mac.",
  no_vault_selected:
    "Bitte zuerst einen Tresor auswählen. / Select a vault first.",
  not_found:
    "Der angeforderte Inhalt wurde nicht gefunden. / The requested item was not found.",
  not_signed_in:
    "Bitte zuerst anmelden. / Sign in first.",
  passwords_must_differ:
    "Konto-Passwort und Tresor-Passwort müssen verschieden sein. Der Server sieht das Konto-Passwort. / Account password and vault password must differ. The server sees the account password.",
  permission_denied:
    "Diese Aktion ist nicht erlaubt. / This action is not allowed.",
  protocol_error:
    "Diese Tresordaten werden von dieser 4AllPass-Version nicht unterstützt. / This vault data is not supported by this version of 4AllPass.",
  rollback_detected:
    "Ein älterer Tresorstand wurde erkannt und aus Sicherheitsgründen nicht geöffnet. / An older vault state was detected and was not opened for safety.",
  service_unavailable:
    "4AllPass konnte die Aktion gerade nicht abschließen. Bitte erneut versuchen. / 4AllPass could not finish the action right now. Please try again.",
  unexpected:
    "Etwas hat nicht funktioniert. Es wurden keine technischen Details angezeigt. Bitte erneut versuchen. / Something did not work. No technical details were shown. Please try again.",
  vault_locked:
    "Der Tresor ist gesperrt. Bitte zuerst öffnen. / The vault is locked. Open it first.",
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
