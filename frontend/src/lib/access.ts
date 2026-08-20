/**
 * Local access policy for the n8n demo. Never uploaded.
 * FastAPI is not in this path. Secrets are not written to audit rows.
 */
import type { VaultEntry } from "./entries.ts";

export const TRUSTED_APPLICATIONS = ["n8n"] as const;

export interface AccessRequest {
  application: string;
  provider: string;
  credential: string;
  scope: string[];
  ttlSeconds: number;
}

export type DenyReason =
  | "application_not_allowed"
  | "no_credential"
  | "scope_not_permitted"
  | "expired"
  | "denied_by_user";

export type AccessVerdict =
  | { status: "pending"; entryId: string; risk: boolean }
  | { status: "denied"; reason: DenyReason };

export interface AccessGrant {
  id: string;
  application: string;
  provider: string;
  entryId: string;
  scope: string[];
  expiresAt: number;
  material: string;
}

export interface AccessAudit {
  at: string;
  application: string;
  provider: string;
  scope: string[];
  decision: "APPROVED" | "DENIED" | "EXPIRED";
  reason?: DenyReason;
}

export function isTrustedApplication(name: string): boolean {
  return TRUSTED_APPLICATIONS.includes(name.trim().toLowerCase() as (typeof TRUSTED_APPLICATIONS)[number]);
}

export function capabilitiesOf(entry: VaultEntry): string[] {
  return entry.capabilities.trim().split(/[,\s]+/).filter(Boolean);
}

function matchesProvider(entry: VaultEntry, provider: string): boolean {
  if (!provider) return false;
  const keys = [entry.provider, entry.title]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return keys.includes(provider);
}

export function decideAccess(request: AccessRequest, entries: VaultEntry[]): AccessVerdict {
  if (!isTrustedApplication(request.application)) {
    return { status: "denied", reason: "application_not_allowed" };
  }
  const provider = request.provider.trim().toLowerCase();
  const account = request.credential.trim().toLowerCase();
  if (!provider || !account) {
    return { status: "denied", reason: "no_credential" };
  }
  const match = entries.find((entry) => {
    if (!matchesProvider(entry, provider)) return false;
    const a = entry.account.trim().toLowerCase() || "personal";
    return a === account;
  });
  if (!match) return { status: "denied", reason: "no_credential" };
  const caps = capabilitiesOf(match);
  if (request.scope.length === 0 || !request.scope.every((scope) => caps.includes(scope))) {
    return { status: "denied", reason: "scope_not_permitted" };
  }
  return {
    status: "pending",
    entryId: match.id,
    risk: request.scope.some((scope) => /write|delete|admin/i.test(scope)),
  };
}

export function issueGrant(
  request: AccessRequest,
  entry: VaultEntry,
  now = Date.now(),
): AccessGrant {
  const ttl = Math.max(1, request.ttlSeconds) * 1000;
  return {
    id: `grant_${now.toString(16)}`,
    application: request.application.trim().toLowerCase(),
    provider: request.provider.trim(),
    entryId: entry.id,
    scope: [...request.scope],
    expiresAt: now + ttl,
    material: entry.password,
  };
}

export function readGrant(grant: AccessGrant, now = Date.now()): { material: string } | { status: "denied"; reason: "expired" } {
  if (now >= grant.expiresAt) return { status: "denied", reason: "expired" };
  return { material: grant.material };
}

export function wipeGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, material: "", expiresAt: 0 };
}

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
    decision,
    ...(reason ? { reason } : {}),
  };
}

export function auditContainsSecret(row: AccessAudit, secret: string): boolean {
  if (!secret) return false;
  return JSON.stringify(row).includes(secret);
}
