import type { DenyReason } from "../access/types.ts";

export type AuditEventType =
  | "access.requested"
  | "access.allowed"
  | "access.denied"
  | "access.expired"
  | "policy.changed";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: number;
  requestId?: string;
  application?: string;
  provider?: string;
  capability?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AccessAudit {
  at: string;
  application: string;
  provider: string;
  scope: string[];
  ttlSeconds: number;
  decision: "APPROVED" | "DENIED" | "EXPIRED";
  reason?: DenyReason;
}
