/** Legacy mode names remain parseable; neither exports credentials.
 * A protected host uses its separate operation contract, not this grant API.
 */
export const HANDOFF_MODES = ["raw_secret", "mediated"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

/** What the running broker can actually do. Not a promise. */
export const AVAILABLE_HANDOFF: readonly HandoffMode[] = [];

export function parseHandoff(value: unknown): HandoffMode | "invalid" {
  if (value === undefined || value === null || value === "") return "mediated";
  if (value === "raw_secret" || value === "mediated") return value;
  return "invalid";
}

export function handoffIsAvailable(mode: HandoffMode): boolean {
  return AVAILABLE_HANDOFF.includes(mode);
}
