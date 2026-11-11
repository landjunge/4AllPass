/** Agent access adapter over @4allpass/core. */
import {
  DEFAULT_HANDOFF,
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
  type AccessRequest,
  type AccessVerdict,
  type AccessWhy,
  type Credential,
  type DenyReason,
  type HandoffMode,
} from "@4allpass/core";
import type { VaultEntry } from "../entries/index.ts";

export {
  DEFAULT_HANDOFF,
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
  type HandoffMode,
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
  handoff: HandoffMode;
}

/** issueGrant only emits a grant for a handoff mode the broker can serve. */
export type GrantIssueResult =
  | { status: "issued"; grant: AccessGrant }
  | { status: "denied"; reason: "handoff_unavailable" };

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

export function issueGrant(
  request: AccessRequest,
  entry: VaultEntry,
  now = Date.now(),
): GrantIssueResult {
  const meta = issueGrantCore(request, entry.id, now);
  if (meta.status === "denied") return { status: "denied", reason: meta.reason };
  return {
    status: "issued",
    grant: {
      id: meta.grant.id,
      application: meta.grant.applicationId,
      provider: meta.grant.provider,
      entryId: meta.grant.credentialId,
      scope: meta.grant.scope,
      expiresAt: meta.grant.expiresAt,
      material: "", // Never copy vault material into a machine grant.
      handoff: meta.grant.handoff,
    },
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
