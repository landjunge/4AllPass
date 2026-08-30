/**
 * How a secret may leave the unlocked vault after a human Allow.
 *
 * v1 can only copy bytes (`raw_secret`). A mediated proxy — 4AllPass uses the
 * secret, the agent does not hold it — is typed here so callers can ask and
 * be denied honestly. Do not silently fall back from mediated to raw_secret.
 */
export const HANDOFF_MODES = ["raw_secret", "mediated"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

/** What the running broker can actually do. Not a promise. */
export const AVAILABLE_HANDOFF: readonly HandoffMode[] = ["raw_secret"];

export function parseHandoff(value: unknown): HandoffMode | "invalid" {
  if (value === undefined || value === null || value === "") return "raw_secret";
  if (value === "raw_secret" || value === "mediated") return value;
  return "invalid";
}

export function handoffIsAvailable(mode: HandoffMode): boolean {
  return AVAILABLE_HANDOFF.includes(mode);
}
