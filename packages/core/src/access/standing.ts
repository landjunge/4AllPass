/**
 * Standing grant path — parallel to live Allow, not a silent override of it.
 *
 * Requires a verified requester id (signature already checked by the caller
 * with `@4allpass/crypto` `verifyRequesterSignature`). The string
 * `application: "n8n"` is not identity here.
 *
 * The sidecar / broker is not wired to this path. Core only answers the
 * policy question. Actuation never auto-approves.
 */
import type { Credential } from "../credentials/types.ts";
import { credentialRiskClass, type RiskClass } from "../credentials/types.ts";
import {
  clampStandingTtl,
  STANDING_RATE_MAX,
  STANDING_RATE_WINDOW_MS,
  STANDING_RULE_MAX_AGE_MS,
  ttlIsAllowed,
} from "./limits.ts";
import type { AccessRequest, DenyReason } from "./types.ts";

function providerKey(credential: Credential): string {
  return (credential.provider || credential.label).trim().toLowerCase();
}

function credentialAllows(request: AccessRequest, match: Credential): DenyReason | null {
  if (providerKey(match) !== request.provider.trim().toLowerCase()) {
    return "no_credential";
  }
  if (match.capabilities.length === 1 && match.capabilities[0] === "revoked") {
    return "revoked_credential";
  }
  if (
    request.scope.length === 0 ||
    !request.scope.every((scope) => match.capabilities.includes(scope))
  ) {
    return "scope_not_permitted";
  }
  return null;
}

export interface StandingRule {
  requesterId: string;
  credentialId: string;
  provider: string;
  scope: readonly string[];
  /** Human-set at enrollment. Never inferred from a transport. */
  riskClass: RiskClass;
  createdAt: number;
  expiresAt: number;
  maxTtlSeconds: number;
}

export type StandingDecision =
  | {
      status: "approved";
      credentialId: string;
      ttlSeconds: number;
      ruleExpiresAt: number;
      riskClass: "data";
    }
  | {
      status: "pending";
      credentialId: string;
      reason: "actuation_requires_live";
      riskClass: "actuation";
    }
  | { status: "denied"; reason: DenyReason };

export function takeRateSlot(
  timestamps: readonly number[],
  now: number,
  windowMs = STANDING_RATE_WINDOW_MS,
  max = STANDING_RATE_MAX,
): { ok: true; timestamps: number[] } | { ok: false; timestamps: number[] } {
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    return { ok: false, timestamps: recent };
  }
  return { ok: true, timestamps: [...recent, now] };
}

export function standingRuleIsFresh(rule: StandingRule, now: number): boolean {
  if (now >= rule.expiresAt) return false;
  if (rule.expiresAt - rule.createdAt > STANDING_RULE_MAX_AGE_MS) return false;
  if (now - rule.createdAt > STANDING_RULE_MAX_AGE_MS) return false;
  return true;
}

export function decideStandingAccess(
  request: AccessRequest,
  credentials: readonly Credential[],
  rules: readonly StandingRule[],
  rateTimestamps: readonly number[],
  now = Date.now(),
): { decision: StandingDecision; rateTimestamps: number[] } {
  const requesterId = request.requesterId?.trim() ?? "";
  if (!requesterId) {
    return {
      decision: { status: "denied", reason: "standing_unavailable" },
      rateTimestamps: [...rateTimestamps],
    };
  }
  if (!ttlIsAllowed(request.ttlSeconds)) {
    return {
      decision: { status: "denied", reason: "ttl_too_large" },
      rateTimestamps: [...rateTimestamps],
    };
  }

  const slot = takeRateSlot(rateTimestamps, now);
  if (!slot.ok) {
    return {
      decision: { status: "denied", reason: "rate_limited" },
      rateTimestamps: slot.timestamps,
    };
  }

  const provider = request.provider.trim().toLowerCase();
  const rule = rules.find(
    (item) =>
      item.requesterId === requesterId &&
      item.provider.trim().toLowerCase() === provider &&
      request.scope.length > 0 &&
      request.scope.every((scope) => item.scope.includes(scope)),
  );
  if (!rule) {
    return {
      decision: { status: "denied", reason: "standing_unavailable" },
      rateTimestamps: slot.timestamps,
    };
  }
  if (!standingRuleIsFresh(rule, now)) {
    return {
      decision: { status: "denied", reason: "standing_expired" },
      rateTimestamps: slot.timestamps,
    };
  }

  const match = credentials.find((item) => item.id === rule.credentialId);
  if (!match) {
    return {
      decision: { status: "denied", reason: "no_credential" },
      rateTimestamps: slot.timestamps,
    };
  }
  const blocked = credentialAllows(request, match);
  if (blocked) {
    return {
      decision: { status: "denied", reason: blocked },
      rateTimestamps: slot.timestamps,
    };
  }

  const riskClass =
    rule.riskClass === "actuation" || credentialRiskClass(match) === "actuation"
      ? "actuation"
      : "data";
  if (riskClass === "actuation") {
    return {
      decision: {
        status: "pending",
        credentialId: match.id,
        reason: "actuation_requires_live",
        riskClass: "actuation",
      },
      rateTimestamps: slot.timestamps,
    };
  }

  return {
    decision: {
      status: "approved",
      credentialId: match.id,
      ttlSeconds: clampStandingTtl(request.ttlSeconds, rule.maxTtlSeconds),
      ruleExpiresAt: rule.expiresAt,
      riskClass: "data",
    },
    rateTimestamps: slot.timestamps,
  };
}
