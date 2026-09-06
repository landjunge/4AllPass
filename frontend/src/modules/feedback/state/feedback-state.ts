import { describeError, type ErrorFeedback } from "../errors/describe-error.ts";

export type NoticeCode =
  | "device_soft_revoked"
  | "device_unlock_enabled"
  | "entries_imported"
  | "entries_saved"
  | "password_reuse_warning"
  | "recovery_compromised_rotated"
  | "recovery_replaced"
  | "share_restored"
  | "vault_created"
  | "vault_key_rotated";

export interface NoticeFeedback {
  kind: "notice";
  code: NoticeCode;
  userText: string;
}

export interface FeedbackState {
  error: ErrorFeedback | null;
  notice: NoticeFeedback | null;
}

export type FeedbackAction =
  | { type: "action_started" }
  | { type: "action_failed"; error: unknown }
  | { type: "notice"; code: NoticeCode }
  | { type: "clear" };

const NOTICE_TEXT: Record<NoticeCode, string> = {
  device_soft_revoked:
    "Aus dem nächsten Sync genommen. Ein Gerät, das diesen Tresor-Schlüssel schon kennt, kennt ihn weiter. / Removed from the next sync. A device that already knows this vault key still knows it.",
  device_unlock_enabled:
    "Geräte-Entsperren ist an. Das Tresor-Passwort gilt weiter. / Device unlock enabled. The vault password still works.",
  entries_imported:
    "Einträge übernommen. Dieser Tresor bleibt offen. / Entries pulled in. This vault stays open.",
  entries_saved: "Gespeichert. / Saved.",
  password_reuse_warning:
    "Konto- und Tresor-Passwort sind gleich. Ein Server, der das Konto-Passwort sieht, kann den Tresor öffnen. Ändere eines. / Account and vault passwords are the same. A server that sees the account password can open the vault. Change one.",
  recovery_compromised_rotated:
    "Tresor-Schlüssel gewechselt, weil das Recovery-Kit gestohlen sein kann. Neuen Schlüssel sichern. / Vault key rotated because the recovery kit may be stolen. Save the new kit.",
  recovery_replaced:
    "Neuer Recovery-Schlüssel gedruckt. Der alte öffnet diesen Stand nicht mehr. / New recovery key printed. The previous kit no longer opens this revision.",
  share_restored:
    "Tresor aus Share-Datei wiederhergestellt. Neuen Recovery-Schlüssel sichern. Der Share-Schlüssel ist das nicht. / Vault restored from share file. Store the new recovery key. The share key is not this key.",
  vault_created:
    "Tresor angelegt. Recovery-Schlüssel jetzt sichern. / Vault created. Store the recovery key now.",
  vault_key_rotated:
    "Tresor-Schlüssel gewechselt. Alte Stände lesbar nur für Inhaber des vorigen Schlüssels. / Vault key rotated. Old snapshots stay readable only to holders of the previous key.",
};

export const initialFeedbackState: FeedbackState = { error: null, notice: null };

export function createNotice(code: NoticeCode): NoticeFeedback {
  return { kind: "notice", code, userText: NOTICE_TEXT[code] };
}

export function feedbackReducer(state: FeedbackState, action: FeedbackAction): FeedbackState {
  switch (action.type) {
    case "action_started":
      return { ...state, error: null };
    case "action_failed":
      return { ...state, error: describeError(action.error) };
    case "notice":
      return { ...state, notice: createNotice(action.code) };
    case "clear":
      return initialFeedbackState;
  }
}
