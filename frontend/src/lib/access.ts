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
  | "unknown_provider"
  | "scope_not_permitted"
  | "expired"
  | "denied_by_user"
  | "malformed_request"
  | "revoked_credential"
  | "vault_locked"
  | "broker_timeout";

export type AccessApiResponse =
  | { status: "approved"; access_token: string; expires_in: number }
  | { status: "denied"; reason: DenyReason };

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
  ttlSeconds: number;
  decision: "APPROVED" | "DENIED" | "EXPIRED";
  reason?: DenyReason;
}

export function isTrustedApplication(name: string): boolean {
  return TRUSTED_APPLICATIONS.includes(name.trim().toLowerCase() as (typeof TRUSTED_APPLICATIONS)[number]);
}

export function capabilitiesOf(entry: VaultEntry): string[] {
  const raw = entry.capabilities.trim();
  if (raw) return raw.split(/[,\s]+/).filter(Boolean);
  if (entry.kind === "api") return ["repository.read"];
  if (entry.kind === "sftp") return ["sftp.read"];
  return ["login"];
}

function providerKey(entry: VaultEntry): string {
  return (entry.provider || entry.title).trim().toLowerCase();
}

export function parseAccessBody(input: unknown): AccessRequest | { status: "denied"; reason: "malformed_request" } {
  if (!input || typeof input !== "object") return { status: "denied", reason: "malformed_request" };
  const body = input as Record<string, unknown>;
  if (typeof body.application !== "string" || typeof body.provider !== "string") {
    return { status: "denied", reason: "malformed_request" };
  }
  if (!Array.isArray(body.scope) || body.scope.some((item) => typeof item !== "string")) {
    return { status: "denied", reason: "malformed_request" };
  }
  const ttl = body.ttl ?? body.ttlSeconds;
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) {
    return { status: "denied", reason: "malformed_request" };
  }
  return {
    application: body.application,
    provider: body.provider,
    credential: typeof body.credential === "string" ? body.credential : "personal",
    scope: body.scope as string[],
    ttlSeconds: ttl,
  };
}

export function decideAccess(request: AccessRequest, entries: VaultEntry[]): AccessVerdict {
  if (!isTrustedApplication(request.application)) {
    return { status: "denied", reason: "application_not_allowed" };
  }
  if (!request.provider.trim()) {
    return { status: "denied", reason: "unknown_provider" };
  }
  const provider = request.provider.trim().toLowerCase();
  const account = request.credential.trim().toLowerCase();
  const match = entries.find((entry) => {
    if (providerKey(entry) !== provider && !providerKey(entry).includes(provider)) return false;
    const a = entry.account.trim().toLowerCase();
    if (!account || account === "personal") return a === "" || a === "personal" || a === account;
    return a === account;
  });
  if (!match) return { status: "denied", reason: "no_credential" };
  if (match.capabilities.trim() === "revoked") {
    return { status: "denied", reason: "revoked_credential" };
  }
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
    ttlSeconds: request.ttlSeconds,
    decision,
    ...(reason ? { reason } : {}),
  };
}

export function formatAuditClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

export function auditContainsSecret(row: AccessAudit, secret: string): boolean {
  if (!secret) return false;
  return JSON.stringify(row).includes(secret);
}

export function approvedResponse(grant: AccessGrant, now = Date.now()): AccessApiResponse {
  const live = readGrant(grant, now);
  if ("status" in live) return { status: "denied", reason: "expired" };
  const expiresIn = Math.max(0, Math.floor((grant.expiresAt - now) / 1000));
  return { status: "approved", access_token: live.material, expires_in: expiresIn };
}

export function deniedResponse(reason: DenyReason): AccessApiResponse {
  return { status: "denied", reason };
}

export const ACCESS_CHANNEL = "4allpass-access-v1";

export interface AccessWireRequest {
  v: 1;
  id: string;
  method: "POST /v1/access/request";
  body: unknown;
}

export interface AccessWireReply {
  v: 1;
  id: string;
  body: AccessApiResponse;
}
