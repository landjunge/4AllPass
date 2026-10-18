/** Agent access adapter over @4allpass/core. */
import {
  auditContainsSecret,
  auditLine,
  decideAccess as decideAccessCore,
  explainAccess,
  explainDenyReason,
  formatAuditClock,
  issueGrant as issueGrantCore,
  parseAccessBody,
  whyContainsSecret,
  type AccessApiResponse,
  type AccessAudit,
  type AccessGrant as CoreGrant,
  type AccessRequest,
  type AccessVerdict,
  type AccessWhy,
  type Credential,
  type DenyReason,
} from "@4allpass/core";
import type { VaultEntry } from "../entries/index.ts";

export {
  auditContainsSecret,
  auditLine,
  explainAccess,
  explainDenyReason,
  formatAuditClock,
  parseAccessBody,
  whyContainsSecret,
  type AccessApiResponse,
  type AccessAudit,
  type AccessRequest,
  type AccessVerdict,
  type AccessWhy,
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

export interface AccessGrant {
  id: string;
  application: string;
  provider: string;
  entryId: string;
  scope: string[];
  expiresAt: number;
  material: string;
  handoff: "raw_secret";
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
    material: "", // Never copy vault material into a machine grant.
    handoff: "raw_secret",
  };
}

export function readGrant(
  grant: AccessGrant,
  now = Date.now(),
): { material: string } | { status: "denied"; reason: "expired" | "handoff_unavailable" } {
  void grant;
  void now;
  return { status: "denied", reason: "handoff_unavailable" };
}

export function wipeGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, material: "", expiresAt: 0 };
}

export function approvedResponse(grant: AccessGrant, now = Date.now()): AccessApiResponse {
  // Reject even a legacy in-memory grant created before this policy change.
  void grant;
  void now;
  return { status: "denied", reason: "handoff_unavailable" };
}

export function deniedResponse(reason: DenyReason): AccessApiResponse {
  return { status: "denied", reason };
}
