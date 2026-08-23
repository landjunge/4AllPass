export type DomainMatch = "exact" | "subdomain" | "login";

export type ProviderCategory =
  | "developer"
  | "identity"
  | "mail"
  | "cloud"
  | "social"
  | "commerce"
  | "other";

export type CredentialKind = "web-login" | "api" | "oauth" | "smtp" | "ftp" | "domain";

export type MatchType =
  | "exact-domain"
  | "subdomain"
  | "known-login-domain"
  | "user-override"
  | "heuristic"
  | "unknown";

export interface DomainRule {
  host: string;
  match: DomainMatch;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  domains: DomainRule[];
  category: ProviderCategory;
  aliases?: string[];
  credentialKinds?: CredentialKind[];
}

export interface UserOverride {
  host: string;
  match: Exclude<DomainMatch, "login">;
  providerId: string;
}

export interface ProviderResolution {
  providerId: string | null;
  providerName: string | null;
  confidence: number;
  matchType: MatchType;
  matchedDomain: string;
  normalizedDomain: string;
  requiresConfirmation: boolean;
  possibleName: string | null;
}

export const CONFIDENCE = {
  exact: 1,
  override: 1,
  subdomain: 0.98,
  login: 0.95,
  heuristic: 0.61,
  unknown: 0,
} as const;
