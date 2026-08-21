import type { AccessRequest, DenyReason } from "../access/types.ts";
import type { AccessAudit, AuditEvent, AuditEventType } from "./types.ts";

export type { AccessAudit, AuditEvent, AuditEventType } from "./types.ts";

export function auditLine(
  request: AccessRequest,
  decision: "APPROVED" | "DENIED" | "EXPIRED",
  reason?: DenyReason,
  at = new Date().toISOString(),
): AccessAudit {
  return {
    at,
    application: request.application,
    provider: request.provider,
    scope: [...request.scope],
    ttlSeconds: request.ttlSeconds,
    decision,
    ...(reason ? { reason } : {}),
  };
}

export function auditEvent(
  type: AuditEventType,
  request: AccessRequest,
  now = Date.now(),
): AuditEvent {
  const capability = request.scope[0];
  return {
    id: `aud_${now.toString(16)}`,
    type,
    timestamp: now,
    ...(request.id ? { requestId: request.id } : {}),
    application: request.application,
    provider: request.provider,
    ...(capability ? { capability } : {}),
  };
}

export function auditContainsSecret(row: AccessAudit, secret: string): boolean {
  if (!secret) return false;
  return JSON.stringify(row).includes(secret);
}

export function formatAuditClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour12: false });
}
