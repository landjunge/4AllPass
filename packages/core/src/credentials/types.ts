/** Vault item as the policy sees it. No password / PAT field. */
export type RiskClass = "data" | "actuation";

export interface Credential {
  id: string;
  provider: string;
  label: string;
  account: string;
  capabilities: string[];
  /**
   * Human-set. Omitted = data (existing entries).
   * Never inferred from a transport or protocol.
   */
  riskClass?: RiskClass;
}

export function credentialRiskClass(credential: Credential): RiskClass {
  return credential.riskClass === "actuation" ? "actuation" : "data";
}
