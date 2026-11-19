/** Legacy mode names remain parseable; neither exports credentials.
 * A protected host uses its separate operation contract, not this grant API.
 */
export const HANDOFF_MODES = ["raw_secret", "mediated"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

/** What the running broker can actually do. Not a promise. */
export const AVAILABLE_HANDOFF: readonly HandoffMode[] = [];

/**
 * Mode for an omitted handoff. One value for parser, policy and grant issue:
 * omission must never be read as the more invasive `raw_secret`.
 */
export const DEFAULT_HANDOFF: HandoffMode = "mediated";

/** A missing mode always means DEFAULT_HANDOFF, never an implicit raw export. */
export function effectiveHandoff(mode: HandoffMode | undefined): HandoffMode {
  return mode ?? DEFAULT_HANDOFF;
}

/**
 * The only handoff gate. Returns null when the running broker cannot serve the
 * mode; callers must deny instead of issuing a grant. An omitted mode resolves
 * through DEFAULT_HANDOFF, so a future reopen cannot turn omission into
 * `raw_secret` by accident.
 */
export function resolveHandoff(
  mode: HandoffMode | undefined,
  available: readonly HandoffMode[] = AVAILABLE_HANDOFF,
): HandoffMode | null {
  const requested = effectiveHandoff(mode);
  return available.includes(requested) ? requested : null;
}

export function parseHandoff(value: unknown): HandoffMode | "invalid" {
  if (value === undefined || value === null || value === "") return DEFAULT_HANDOFF;
  if (value === "raw_secret" || value === "mediated") return value;
  return "invalid";
}

export function handoffIsAvailable(mode: HandoffMode): boolean {
  return AVAILABLE_HANDOFF.includes(mode);
}
