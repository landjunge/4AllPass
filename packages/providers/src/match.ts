import type { DomainMatch } from "./types.ts";

/**
 * Never `domain.endsWith(host)` — that would match evilgithub.com to github.com.
 * Subdomain means `=== host` or `endsWith("." + host)`.
 */
export function hostMatches(domain: string, host: string, match: DomainMatch): boolean {
  const needle = host.trim().toLowerCase();
  if (!domain || !needle) return false;
  if (match === "exact" || match === "login") {
    return domain === needle;
  }
  return domain === needle || domain.endsWith(`.${needle}`);
}
