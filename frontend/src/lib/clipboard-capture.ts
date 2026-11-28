/**
 * Pure state machine for the one-shot, time-bounded clipboard capture phase
 * (issue #278). No timers and no clipboard I/O live here — a caller (the
 * `useVaultKeyCreate` hook) owns the `setInterval`/`setTimeout` and feeds
 * each clipboard read back through `tickCapture`. Keeping the decisions
 * here, pure, is what makes "timeout", "not a key", and "provider changed
 * mid-capture" each independently testable without a fake clock touching
 * React state.
 */
import { detectProviderKey, type KeyCreateProviderId } from "./provider-key-create.ts";
import type { DetectedCredential } from "./detect.ts";

export interface CaptureState {
  readonly providerId: KeyCreateProviderId;
  readonly startedAt: number;
  readonly deadline: number;
}

export function startCapture(
  providerId: KeyCreateProviderId,
  now: number,
  timeoutMs: number,
): CaptureState {
  return { providerId, startedAt: now, deadline: now + timeoutMs };
}

export function isCaptureExpired(capture: CaptureState, now: number): boolean {
  return now >= capture.deadline;
}

export type CaptureTick =
  | { type: "expired" }
  | { type: "empty" }
  | { type: "not-a-key" }
  | { type: "captured"; credential: DetectedCredential };

/**
 * One poll of the active capture phase. `providerId` is the *currently
 * selected* provider at poll time — a caller must cancel the capture the
 * instant the user changes the provider dropdown (see
 * `providerChangedDuringCapture`) rather than rely on this function to
 * notice, so this only re-confirms it as a defensive check.
 */
export function tickCapture(
  capture: CaptureState,
  currentProviderId: KeyCreateProviderId,
  clipboardText: string,
  now: number,
): CaptureTick {
  if (isCaptureExpired(capture, now)) return { type: "expired" };
  if (capture.providerId !== currentProviderId) return { type: "expired" };
  const text = clipboardText.trim();
  if (!text) return { type: "empty" };
  const credential = detectProviderKey(capture.providerId, text);
  if (!credential) return { type: "not-a-key" };
  return { type: "captured", credential };
}

/** A provider switch mid-capture is never silent — it always ends the phase. */
export function providerChangedDuringCapture(
  capture: CaptureState,
  nextProviderId: KeyCreateProviderId | "",
): boolean {
  return nextProviderId !== capture.providerId;
}

export function remainingSeconds(capture: CaptureState, now: number): number {
  return Math.max(0, Math.ceil((capture.deadline - now) / 1000));
}

/**
 * Whether a capture phase may start at all: a provider must be chosen and
 * the vault must be unlocked. A locked vault refuses the capture up front
 * rather than starting a timer the UI would have to tear down the instant
 * it noticed the lock.
 */
export function canStartCapture(providerId: string, vaultLocked: boolean): boolean {
  return providerId !== "" && !vaultLocked;
}

/**
 * Guards a clipboard read that may have been in flight when its capture
 * was stopped, cancelled, or superseded by a later one — clearing the
 * polling interval alone cannot cancel an already-issued `readText()`
 * promise, so every poll tags its read with the generation active when it
 * was issued, and the result is applied only if that generation is still
 * current when the read resolves.
 */
export function isStaleGeneration(currentGeneration: number, readGeneration: number): boolean {
  return currentGeneration !== readGeneration;
}

/**
 * A capture belongs to the draft that started it. `sessionKey` identifies
 * that draft (bumped by the caller whenever the open draft changes
 * identity — a new blank draft, a different existing entry selected, or
 * the form closed); if it no longer matches what the capture started with,
 * the capture must end rather than let a later clipboard match land on
 * whatever draft happens to be open when it resolves.
 */
export function sessionChanged(startedWithSessionKey: number, currentSessionKey: number): boolean {
  return startedWithSessionKey !== currentSessionKey;
}
