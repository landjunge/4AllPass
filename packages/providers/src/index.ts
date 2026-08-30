export {
  CONFIDENCE,
  type CredentialKind,
  type DomainMatch,
  type DomainRule,
  type MatchType,
  type ProviderCategory,
  type ProviderDefinition,
  type ProviderResolution,
  type UserOverride,
} from "./types.ts";
export { normalizeDomain, possibleRegistrable } from "./normalize.ts";
export { hostMatches } from "./match.ts";
export { resolveProvider, type ResolveOptions } from "./resolve.ts";
export { BUILTIN_PROVIDERS, providerById } from "./registry/index.ts";
export {
  detectSetup,
  DETECT_FIELD_ONLY_MAX,
  DETECT_HIGH_MIN,
  type DetectionSignals,
  type SetupSuggestion,
} from "./detect.ts";
