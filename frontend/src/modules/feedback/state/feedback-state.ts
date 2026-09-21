import type { Line } from "../../../lib/copy-mode.ts";
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
  userText: Line;
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

const NOTICE_TEXT: Record<NoticeCode, Line> = {
  device_soft_revoked: {
    de: "Aus dem nächsten Sync genommen. Ein Gerät, das diesen Tresor-Schlüssel schon kennt, kennt ihn weiter.",
    en: "Removed from the next sync. A device that already knows this vault key still knows it.",
  },
  device_unlock_enabled: {
    de: "Geräte-Entsperren ist an. Das Tresor-Passwort gilt weiter.",
    en: "Device unlock enabled. The vault password still works.",
  },
  entries_imported: {
    de: "Einträge übernommen. Dieser Tresor bleibt offen.",
    en: "Entries pulled in. This vault stays open.",
  },
  entries_saved: {
    de: "Gespeichert.",
    en: "Saved.",
  },
  password_reuse_warning: {
    de: "Konto- und Tresor-Passwort sind gleich. Ein Server, der das Konto-Passwort sieht, kann den Tresor öffnen. Ändere eines.",
    en: "Account and vault passwords are the same. A server that sees the account password can open the vault. Change one.",
  },
  recovery_compromised_rotated: {
    de: "Tresor-Schlüssel gewechselt, weil das Recovery-Kit gestohlen sein kann. Neuen Schlüssel sichern.",
    en: "Vault key rotated because the recovery kit may be stolen. Save the new kit.",
  },
  recovery_replaced: {
    de: "Neuer Recovery-Schlüssel gedruckt. Der alte öffnet diesen Stand nicht mehr.",
    en: "New recovery key printed. The previous kit no longer opens this revision.",
  },
  share_restored: {
    de: "Tresor aus Share-Datei wiederhergestellt. Neuen Recovery-Schlüssel sichern. Der Share-Schlüssel ist das nicht.",
    en: "Vault restored from share file. Store the new recovery key. The share key is not this key.",
  },
  vault_created: {
    de: "Tresor angelegt. Recovery-Schlüssel jetzt sichern.",
    en: "Vault created. Store the recovery key now.",
  },
  vault_key_rotated: {
    de: "Tresor-Schlüssel gewechselt. Alte Stände lesbar nur für Inhaber des vorigen Schlüssels.",
    en: "Vault key rotated. Old snapshots stay readable only to holders of the previous key.",
  },
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
