import { handoffIsAvailable } from "../access/handoff.ts";
import type { AccessDecision, AccessRequest, AccessVerdict } from "../access/types.ts";
import { scopeIsRisky } from "../capabilities/registry.ts";
import type { Credential } from "../credentials/types.ts";
import { TRUSTED_APPLICATIONS } from "./types.ts";

export function isTrustedApplication(name: string): boolean {
  return TRUSTED_APPLICATIONS.includes(
    name.trim().toLowerCase() as (typeof TRUSTED_APPLICATIONS)[number],
  );
}

function providerKey(credential: Credential): string {
  return (credential.provider || credential.label).trim().toLowerCase();
}

function requestIdOf(request: AccessRequest): string {
  return request.id ?? "";
}

export function evaluatePolicy(
  request: AccessRequest,
  credentials: readonly Credential[],
): AccessDecision {
  const requestId = requestIdOf(request);
  if (!isTrustedApplication(request.application)) {
    return { decision: "deny", requestId, reason: "application_not_allowed" };
  }
  const handoff = request.handoff ?? "raw_secret";
  if (!handoffIsAvailable(handoff)) {
    return { decision: "deny", requestId, reason: "handoff_unavailable" };
  }
  if (!request.provider.trim()) {
    return { decision: "deny", requestId, reason: "unknown_provider" };
  }
  const provider = request.provider.trim().toLowerCase();
  const account = request.credential.trim().toLowerCase();
  const match = credentials.find((item) => {
    if (providerKey(item) !== provider) return false;
    const a = item.account.trim().toLowerCase();
    if (!account || account === "personal") return a === "" || a === "personal" || a === account;
    return a === account;
  });
  if (!match) return { decision: "deny", requestId, reason: "no_credential" };
  if (match.capabilities.length === 1 && match.capabilities[0] === "revoked") {
    return { decision: "deny", requestId, reason: "revoked_credential" };
  }
  if (
    request.scope.length === 0 ||
    !request.scope.every((scope) => match.capabilities.includes(scope))
  ) {
    return { decision: "deny", requestId, reason: "scope_not_permitted" };
  }
  return {
    decision: "allow",
    requestId,
    credentialId: match.id,
    risk: scopeIsRisky(request.scope),
  };
}

/** Existing PWA/broker verdict shape. pending = policy allow, still needs a human. */
export function decideAccess(
  request: AccessRequest,
  credentials: readonly Credential[],
): AccessVerdict {
  const decision = evaluatePolicy(request, credentials);
  if (decision.decision === "deny") {
    return { status: "denied", reason: decision.reason };
  }
  return { status: "pending", entryId: decision.credentialId, risk: decision.risk };
}
