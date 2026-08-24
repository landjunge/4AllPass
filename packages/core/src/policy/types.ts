import type { AccessDecision, AccessRequest } from "../access/types.ts";
import type { Credential } from "../credentials/types.ts";

export const TRUSTED_APPLICATIONS = ["n8n"] as const;

export interface PolicyEngine {
  evaluate(request: AccessRequest, credentials: readonly Credential[]): AccessDecision;
}
