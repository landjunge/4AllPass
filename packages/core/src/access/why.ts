import type { AccessRequest, AccessVerdict, DenyReason } from "./types.ts";

export type AccessWhyCode = DenyReason | "pending_human_allow";

export interface AccessWhy {
  code: AccessWhyCode;
  /** DE + EN. Never a secret, PAT, or password. */
  why: string;
}

const DENY_WHY: Record<DenyReason, string> = {
  application_not_allowed:
    "Unbekannte Anwendung = DENY. / Unknown application = DENY.",
  no_credential:
    "Kein passendes Credential im Tresor. / No matching credential in the vault.",
  unknown_provider:
    "Provider fehlt oder ist unbekannt. / Provider is missing or unknown.",
  scope_not_permitted:
    "Diese Fähigkeit steht auf dem Credential nicht. / That capability is not on the credential.",
  expired:
    "Der Grant ist abgelaufen. Ein schon übergebener Secret ist nicht un-known. / The grant expired. A copy already given is not un-known.",
  denied_by_user:
    "Du hast Deny gewählt. / You chose Deny.",
  malformed_request:
    "Die Anfrage ist ungültig. / The request is malformed.",
  revoked_credential:
    "Das Credential ist widerrufen. / The credential is revoked.",
  vault_locked:
    "Der Tresor ist gesperrt. / The vault is locked.",
  broker_timeout:
    "Kein Allow/Deny rechtzeitig. / No Allow/Deny in time.",
};

const PENDING_WHY =
  "Richtlinie erlaubt die Anfrage. Ein Mensch muss noch Allow klicken — kein Auto-Handoff. / Policy allows this request. A human must still click Allow — not auto-handoff.";

export function explainAccess(verdict: AccessVerdict): AccessWhy {
  if (verdict.status === "pending") {
    return { code: "pending_human_allow", why: PENDING_WHY };
  }
  return { code: verdict.reason, why: DENY_WHY[verdict.reason] };
}

export function explainDenyReason(reason: DenyReason): string {
  return DENY_WHY[reason];
}

export function whyContainsSecret(why: AccessWhy, secret: string): boolean {
  if (!secret) return false;
  return why.why.includes(secret) || why.code.includes(secret);
}

/** Request fields that may appear in UI copy — still never vault secrets. */
export function requestSummary(request: AccessRequest): string {
  const scope = request.scope.join(", ") || "—";
  return `${request.application} → ${request.provider} · ${scope}`;
}
