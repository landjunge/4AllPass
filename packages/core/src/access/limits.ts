/** Hard ceilings. Not UI copy. Live Allow and standing both go through these. */

/** Any access request. 24h — a human can still click Deny. */
export const ACCESS_TTL_SECONDS_MAX = 86_400;

/** Standing auto-handoff. Tight on purpose. */
export const STANDING_TTL_SECONDS_MAX = 300;

/** Standing rule dies without a human re-confirm. */
export const STANDING_RULE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const STANDING_RATE_WINDOW_MS = 60_000;
export const STANDING_RATE_MAX = 10;

export function ttlIsAllowed(ttlSeconds: number, max = ACCESS_TTL_SECONDS_MAX): boolean {
  return Number.isFinite(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= max;
}

export function clampStandingTtl(requested: number, ruleMax: number): number {
  const cap = Math.min(STANDING_TTL_SECONDS_MAX, Math.max(1, ruleMax));
  return Math.min(cap, Math.max(1, requested));
}
