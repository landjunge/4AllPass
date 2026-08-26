import type { AccessDecision, AccessRequest } from "../access/types.ts";
import type { Credential } from "../credentials/types.ts";

/**
 * Display names only. Not a cryptographic agent identity.
 * A local process can send `application: "n8n"`. Policy still needs human Allow.
 */
export const TRUSTED_APPLICATIONS = ["n8n"] as const;

export interface PolicyEngine {
  evaluate(request: AccessRequest, credentials: readonly Credential[]): AccessDecision;
}
