import { ACCESS_TTL_SECONDS_MAX } from "./limits.ts";
import type { AccessGrant, AccessRequest } from "./types.ts";

export function issueGrant(
  request: AccessRequest,
  credentialId: string,
  now = Date.now(),
): AccessGrant {
  const seconds = Math.min(ACCESS_TTL_SECONDS_MAX, Math.max(1, request.ttlSeconds));
  const ttl = seconds * 1000;
  const applicationId = request.application.trim().toLowerCase();
  return {
    id: `grant_${now.toString(16)}`,
    requestId: request.id ?? "",
    applicationId,
    provider: request.provider.trim(),
    capability: request.scope[0] ?? "",
    issuedAt: now,
    expiresAt: now + ttl,
    credentialId,
    scope: [...request.scope],
    handoff: "raw_secret",
  };
}

export function grantIsValid(grant: AccessGrant, now = Date.now()): boolean {
  return now < grant.expiresAt;
}

export function expireGrant(grant: AccessGrant): AccessGrant {
  return { ...grant, expiresAt: 0 };
}
