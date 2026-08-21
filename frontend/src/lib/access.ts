/**
 * PWA/desktop adapter over @4allpass/core.
 * Policy and grant metadata live in core. Secret handoff stays here so the
 * broker API keeps working; core never sees the password.
 */
import {
  auditContainsSecret,
  auditLine,
  decideAccess as decideAccessCore,
  formatAuditClock,
  issueGrant as issueGrantCore,
  parseAccessBody,
  type AccessApiResponse,
  type AccessAudit,
  type AccessGrant as CoreGrant,
  type AccessRequest,
  type AccessVerdict,
  type Credential,
  type DenyReason,
} from "@4allpass/core";
import type { VaultEntry } from "./entries.ts";

export {
  auditContainsSecret,
  auditLine,
  formatAuditClock,
  parseAccessBody,
  type AccessApiResponse,
  type AccessAudit,
  type AccessRequest,
  type AccessVerdict,
  type DenyReason,
};

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

/** UI/broker grant. material is the handoff secret — not part of @4allpass/core. */
export interface AccessGrant {
  id: string;
  application: string;
  provider: string;
  entryId: string;
  scope: string[];
  expiresAt: number;
  material: string;
}

export function capabilitiesOf(entry: VaultEntry): string[] {
  const raw = entry.capabilities.trim();
  if (raw) return raw.split(/[,\s]+/).filter(Boolean);
  if (entry.kind === "api") return ["repository.read"];
  if (entry.kind === "sftp") return ["sftp.read"];
  return ["login"];
}

export function credentialFromEntry(entry: VaultEntry): Credential {
  return {
    id: entry.id,
    provider: entry.provider || entry.title,
    label: entry.title,
    account: entry.account,
    capabilities: capabilitiesOf(entry),
  };
}

export function decideAccess(request: AccessRequest, entries: VaultEntry[]): AccessVerdict {
  return decideAccessCore(request, entries.map(credentialFromEntry));
}

export function issueGrant(request: AccessRequest, entry: VaultEntry, now = Date.now()): AccessGrant {
  const meta: CoreGrant = issueGrantCore(request, entry.id, now);
  return {
    id: meta.id,
    application: meta.applicationId,
    provider: meta.provider,
    entryId: meta.credentialId,
    scope: meta.scope,
    expiresAt: meta.expiresAt,
    material: entry.password,
  };
}

export function readGrant(
  grant: AccessGrant,
  now = Date.now(),
): { material: string } | { status: "denied"; reason: "expired" } {
  if (now >= grant.expiresAt) return { status: "denied", reason: "expired" };
  return { material: grant.material };
}

export function wipeGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, material: "", expiresAt: 0 };
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
