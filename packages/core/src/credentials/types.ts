/** Vault item as the policy sees it. No password / PAT field. */
export interface Credential {
  id: string;
  provider: string;
  label: string;
  account: string;
  capabilities: string[];
}
