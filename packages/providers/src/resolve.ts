import { hostMatches } from "./match.ts";
import { normalizeDomain, possibleRegistrable } from "./normalize.ts";
import { BUILTIN_PROVIDERS, providerById } from "./registry/index.ts";
import {
  CONFIDENCE,
  type MatchType,
  type ProviderDefinition,
  type ProviderResolution,
  type UserOverride,
} from "./types.ts";

export interface ResolveOptions {
  providers?: ProviderDefinition[];
  overrides?: UserOverride[];
}

function unknown(domain: string): ProviderResolution {
  const possible = possibleRegistrable(domain);
  return {
    providerId: null,
    providerName: null,
    confidence: possible ? CONFIDENCE.heuristic : CONFIDENCE.unknown,
    matchType: possible ? "heuristic" : "unknown",
    matchedDomain: domain,
    normalizedDomain: domain,
    requiresConfirmation: true,
    possibleName: possible,
  };
}

function hit(
  domain: string,
  provider: ProviderDefinition,
  matchType: MatchType,
  matchedDomain: string,
  confidence: number,
): ProviderResolution {
  return {
    providerId: provider.id,
    providerName: provider.name,
    confidence,
    matchType,
    matchedDomain,
    normalizedDomain: domain,
    requiresConfirmation: confidence < 0.95,
    possibleName: null,
  };
}

export function resolveProvider(input: string, options: ResolveOptions = {}): ProviderResolution {
  const domain = normalizeDomain(input);
  if (!domain) {
    return {
      providerId: null,
      providerName: null,
      confidence: 0,
      matchType: "unknown",
      matchedDomain: "",
      normalizedDomain: "",
      requiresConfirmation: true,
      possibleName: null,
    };
  }

  const catalog = options.providers ?? BUILTIN_PROVIDERS;
  const overrides = options.overrides ?? [];

  for (const rule of overrides) {
    if (!hostMatches(domain, rule.host, rule.match)) continue;
    const provider = providerById(rule.providerId) ?? catalog.find((item) => item.id === rule.providerId);
    if (!provider) continue;
    return hit(domain, provider, "user-override", rule.host, CONFIDENCE.override);
  }

  let best: ProviderResolution | null = null;

  for (const provider of catalog) {
    for (const rule of provider.domains) {
      if (!hostMatches(domain, rule.host, rule.match)) continue;
      const matchType: MatchType =
        rule.match === "login"
          ? "known-login-domain"
          : rule.match === "subdomain" && domain !== rule.host
            ? "subdomain"
            : "exact-domain";
      const confidence =
        matchType === "exact-domain"
          ? CONFIDENCE.exact
          : matchType === "subdomain"
            ? CONFIDENCE.subdomain
            : CONFIDENCE.login;
      const candidate = hit(domain, provider, matchType, rule.host, confidence);
      const spec = (item: ProviderResolution): number =>
        item.normalizedDomain === item.matchedDomain ? 2 : 1;
      if (
        !best ||
        spec(candidate) > spec(best) ||
        (spec(candidate) === spec(best) && candidate.confidence > best.confidence)
      ) {
        best = candidate;
      }
    }
  }

  return best ?? unknown(domain);
}
