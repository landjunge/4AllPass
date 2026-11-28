import { useCallback, useEffect, useRef, useState } from "react";
import type { Line } from "../../lib/copy-mode.ts";
import { clearClipboardIfUnchanged, readClipboardText } from "../../lib/clipboard.ts";
import {
  canStartCapture,
  isCaptureExpired,
  providerChangedDuringCapture,
  remainingSeconds,
  startCapture as startCaptureState,
  tickCapture,
  type CaptureState,
} from "../../lib/clipboard-capture.ts";
import {
  CAPTURE_POLL_MS,
  CAPTURE_TIMEOUT_MS,
  isKeyCreateProviderId,
  keyCreateProviderName,
  type KeyCreateProviderId,
} from "../../lib/provider-key-create.ts";
import { findDuplicateKeyEntry, type DuplicateMatch } from "../../services/vault/duplicates.ts";
import { openProviderKeyPage } from "../../modules/desktop-adapter/index.ts";
import type { DetectedCredential } from "../../lib/detect.ts";
import type { VaultEntry } from "../../types/vault.ts";

export interface KeyCreateCaptureApi {
  providerId: KeyCreateProviderId | "";
  setProviderId: (id: KeyCreateProviderId | "") => void;
  capturing: boolean;
  remainingSeconds: number;
  message: Line | null;
  duplicate: DuplicateMatch | null;
  openProviderPage: () => Promise<void>;
  startCapture: () => void;
  cancelCapture: () => void;
  keepDuplicateAnyway: () => void;
  dismissDuplicate: () => void;
}

/**
 * Drives the "create a new API key" clipboard capture (issue #278): a
 * user-started, time-bounded poll of the clipboard that stops itself on
 * timeout, on a provider change, on a successful/duplicate match, or on
 * unmount — never a standing background watcher. `onCaptured` receives a
 * detected credential only after any duplicate has been resolved; it is the
 * caller's job to fold that into the open draft. Nothing here persists
 * anything or touches the encrypted vault — that stays the existing
 * Save button's job.
 */
export function useKeyCreateCapture(
  entries: readonly VaultEntry[],
  vaultLocked: boolean,
  onCaptured: (credential: DetectedCredential) => void,
): KeyCreateCaptureApi {
  const [providerId, setProviderIdState] = useState<KeyCreateProviderId | "">("");
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [message, setMessage] = useState<Line | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const capturedTextRef = useRef<string | null>(null);
  const pendingCredentialRef = useRef<DetectedCredential | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => stopInterval, [stopInterval]);

  // A lock mid-capture (e.g. an auto-lock timer firing) is never silent —
  // the phase ends and the user sees why, same as a provider switch.
  useEffect(() => {
    if (vaultLocked && capture) {
      stopInterval();
      setCapture(null);
      setMessage({
        de: "Tresor wurde gesperrt. Erfassung abgebrochen.",
        en: "Vault was locked. Capture cancelled.",
      });
    }
  }, [vaultLocked, capture, stopInterval]);

  const finishCapture = useCallback(
    (credential: DetectedCredential, capturedText: string) => {
      const duplicateMatch = findDuplicateKeyEntry(entries, credential.provider, "", credential.password);
      if (duplicateMatch) {
        capturedTextRef.current = capturedText;
        pendingCredentialRef.current = credential;
        setDuplicate(duplicateMatch);
        setMessage(null);
        return;
      }
      onCaptured(credential);
      setMessage({
        de: "Schlüssel aus der Zwischenablage übernommen. Bitte Namen prüfen und speichern.",
        en: "Key taken over from the clipboard. Please check the name and save.",
      });
      void clearClipboardIfUnchanged(capturedText);
    },
    [entries, onCaptured],
  );

  const poll = useCallback(
    (active: CaptureState) => {
      void readClipboardText()
        .catch(() => "")
        .then((text) => {
          const now = Date.now();
          const tick = tickCapture(active, providerId || active.providerId, text, now);
          if (tick.type === "expired") {
            stopInterval();
            setCapture(null);
            setMessage({
              de: "Zeit abgelaufen. Erfassung ist aus. Erneut starten, wenn nötig.",
              en: "Time ran out. Capture is off. Start again if needed.",
            });
            return;
          }
          if (tick.type === "captured") {
            stopInterval();
            setCapture(null);
            finishCapture(tick.credential, text.trim());
            return;
          }
          setRemaining(remainingSeconds(active, now));
          // "empty" / "not-a-key": keep polling silently until timeout — no
          // guessing, no message spam for ordinary clipboard content.
        });
    },
    [providerId, stopInterval, finishCapture],
  );

  const setProviderId = useCallback(
    (next: KeyCreateProviderId | "") => {
      if (capture && providerChangedDuringCapture(capture, next)) {
        stopInterval();
        setCapture(null);
        setMessage({
          de: "Anbieter gewechselt. Erfassung abgebrochen.",
          en: "Provider changed. Capture cancelled.",
        });
      }
      setDuplicate(null);
      setProviderIdState(next);
    },
    [capture, stopInterval],
  );

  const openProviderPage = useCallback(async () => {
    if (!providerId) return;
    const opened = await openProviderKeyPage(providerId);
    setMessage(
      opened
        ? {
            de: `${keyCreateProviderName(providerId)}-Seite im Browser geöffnet.`,
            en: `Opened ${keyCreateProviderName(providerId)}'s page in the browser.`,
          }
        : {
            de: "Konnte die Seite nicht öffnen. Bitte manuell beim Anbieter anmelden.",
            en: "Could not open the page. Please sign in to the provider manually.",
          },
    );
  }, [providerId]);

  const startCapture = useCallback(() => {
    if (!providerId || !isKeyCreateProviderId(providerId)) return;
    if (!canStartCapture(providerId, vaultLocked)) {
      setMessage({ de: "Tresor ist gesperrt. Erst entsperren.", en: "Vault is locked. Unlock it first." });
      return;
    }
    setDuplicate(null);
    const now = Date.now();
    const next = startCaptureState(providerId, now, CAPTURE_TIMEOUT_MS);
    setCapture(next);
    setRemaining(remainingSeconds(next, now));
    setMessage({
      de: "Erfassung läuft. Jetzt beim Anbieter den neuen Schlüssel kopieren.",
      en: "Capture running. Now copy the new key at the provider.",
    });
    stopInterval();
    intervalRef.current = setInterval(() => poll(next), CAPTURE_POLL_MS);
  }, [providerId, vaultLocked, stopInterval, poll]);

  const cancelCapture = useCallback(() => {
    stopInterval();
    setCapture(null);
    setMessage({ de: "Erfassung abgebrochen.", en: "Capture cancelled." });
  }, [stopInterval]);

  const keepDuplicateAnyway = useCallback(() => {
    if (!duplicate || capturedTextRef.current === null || !pendingCredentialRef.current) return;
    const text = capturedTextRef.current;
    const credential = pendingCredentialRef.current;
    setDuplicate(null);
    capturedTextRef.current = null;
    pendingCredentialRef.current = null;
    onCaptured(credential);
    setMessage({
      de: "Als weiterer Eintrag übernommen. Bitte Namen prüfen und speichern.",
      en: "Taken over as another entry. Please check the name and save.",
    });
    void clearClipboardIfUnchanged(text);
  }, [duplicate, onCaptured]);

  const dismissDuplicate = useCallback(() => {
    setDuplicate(null);
    capturedTextRef.current = null;
    pendingCredentialRef.current = null;
    setMessage({ de: "Übernahme verworfen.", en: "Discarded." });
  }, []);

  // Defensive: if the active capture's own deadline already passed (e.g.
  // the tab was backgrounded and the interval was throttled), the next
  // render clears it rather than leaving a stale "capturing" UI forever.
  useEffect(() => {
    if (!capture) return;
    if (isCaptureExpired(capture, Date.now())) {
      stopInterval();
      setCapture(null);
    }
  }, [capture, stopInterval]);

  return {
    providerId,
    setProviderId,
    capturing: capture !== null,
    remainingSeconds: remaining,
    message,
    duplicate,
    openProviderPage,
    startCapture,
    cancelCapture,
    keepDuplicateAnyway,
    dismissDuplicate,
  };
}
