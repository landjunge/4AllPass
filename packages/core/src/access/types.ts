import type { RiskClass } from "../credentials/types.ts";
import type { HandoffMode } from "./handoff.ts";

/**
 * Wire-compatible access request. `application` stays a string so the
 * loopback broker and n8n HTTP recipe do not change.
 */
export interface AccessRequest {
  id?: string;
  application: string;
  provider: string;
  credential: string;
  scope: string[];
  ttlSeconds: number;
  /** Omitted = `raw_secret` (v1 n8n path). `mediated` is denied until a proxy exists. */
  handoff?: HandoffMode;
  reason?: string;
  createdAt?: number;
  /**
   * Cryptographic requester id (`req:ed25519:…`). Optional. The n8n string
   * path ignores this. Standing grants require it.
   */
  requesterId?: string;
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
  | "broker_timeout"
  | "handoff_unavailable"
  | "ttl_too_large"
  | "standing_unavailable"
  | "standing_expired"
  | "rate_limited"
  | "actuation_requires_live";

/** Policy outcome. "allow" means eligible for a human Allow — not auto-handoff. */
export type AccessDecision =
  | {
      decision: "allow";
      requestId: string;
      credentialId: string;
      risk: boolean;
      riskClass: RiskClass;
    }
  | {
      decision: "deny";
      requestId: string;
      reason: DenyReason;
    };

export type AccessVerdict =
  | { status: "pending"; entryId: string; risk: boolean }
  | { status: "denied"; reason: DenyReason };

/** Metadata grant. No secret, no PAT, no password. */
export interface AccessGrant {
  id: string;
  requestId: string;
  applicationId: string;
  provider: string;
  capability: string;
  issuedAt: number;
  expiresAt: number;
  credentialId: string;
  scope: string[];
  /** v1 is always raw_secret. Core still does not hold the bytes. */
  handoff: HandoffMode;
}

export type AccessApiResponse =
  | { status: "approved"; access_token: string; expires_in: number }
  | { status: "denied"; reason: DenyReason };
