import { resolveHandoff } from "./handoff.ts";
import { ACCESS_TTL_SECONDS_MAX } from "./limits.ts";
import type { AccessGrant, AccessRequest, IssueGrantResult } from "./types.ts";

export function issueGrant(
  request: AccessRequest,
  credentialId: string,
  now = Date.now(),
): IssueGrantResult {
  // Choke point: never mint a grant that names a mode this broker cannot serve.
  const handoff = resolveHandoff(request.handoff);
  if (handoff === null) {
    return { status: "denied", reason: "handoff_unavailable" };
  }
  const seconds = Math.min(ACCESS_TTL_SECONDS_MAX, Math.max(1, request.ttlSeconds));
  const ttl = seconds * 1000;
  const applicationId = request.application.trim().toLowerCase();
  return {
    status: "issued",
    grant: {
      id: `grant_${now.toString(16)}`,
      requestId: request.id ?? "",
      applicationId,
      provider: request.provider.trim(),
      capability: request.scope[0] ?? "",
      issuedAt: now,
      expiresAt: now + ttl,
      credentialId,
      scope: [...request.scope],
      handoff,
    },
  };
}

export function grantIsValid(grant: AccessGrant, now = Date.now()): boolean {
  return now < grant.expiresAt;
}

export function expireGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, expiresAt: 0 };
}
