import { useCallback, useEffect, useRef, useState } from "react";
import type { Line } from "../../lib/copy-mode.ts";
import { clearClipboardIfUnchanged, readClipboardText } from "../../lib/clipboard.ts";
import {
  canStartCapture,
  isCaptureExpired,
  isStaleGeneration,
  providerChangedDuringCapture,
  remainingSeconds,
  sessionChanged,
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
  // Identifies the open draft this capture belongs to (e.g. a counter bumped
  // whenever the caller starts a new draft or selects a different entry).
  // A change while capturing means the user left the draft that started the
  // capture — selecting another entry from the list must never let a later
  // clipboard match land in *that* entry. See the "bind capture to the draft
  // that started it" fix (issue #278 review finding).
  sessionKey: number,
  // True only while the open draft is still an API-kind draft. Switching
  // the kind tabs to Web/SFTP does not change `sessionKey` (it is a direct
  // `onChange`, not `startNew`/`startEdit`), so without this the capture
  // would keep polling and silently clear the clipboard on a match even
  // though the panel that could show it is no longer rendered.
  isApiDraft: boolean,
  // The open draft's current account value, read fresh at the moment a
  // capture finishes (not snapshotted when capture started) so an account
  // typed while waiting for the provider still reaches the duplicate
  // check.
  currentAccount: string,
): KeyCreateCaptureApi {
  const [providerId, setProviderIdState] = useState<KeyCreateProviderId | "">("");
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [message, setMessage] = useState<Line | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const capturedTextRef = useRef<string | null>(null);
  const pendingCredentialRef = useRef<DetectedCredential | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Enforces the deadline independently of whether any clipboard read ever
  // resolves (e.g. a stuck OS permission prompt) — `stopInterval` alone
  // only reacts to a read settling, so a hung read would otherwise leave
  // the interval issuing further reads past the advertised bounded window.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always holds the latest `currentAccount` without needing an effect —
  // read only inside `finishCapture`, at the moment a capture actually
  // completes, never snapshotted at capture start.
  const accountRef = useRef(currentAccount);
  accountRef.current = currentAccount;
  // Same reasoning as accountRef: `finishCapture` must see entries added
  // *after* the capture started (e.g. an import run while polling) at the
  // moment it actually runs — not the `entries` array closed over when the
  // already-scheduled `setInterval` callback was created. A `useCallback`
  // identity change does not reach a timer that already captured the old
  // closure.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // Bumped by stopInterval every time a capture is stopped for any reason.
  // Each poll's clipboard read is tagged with the generation active when it
  // was issued; if the generation has moved on by the time the read
  // resolves, the read is stale and its result is discarded unapplied —
  // clearing the interval alone cannot cancel an already in-flight promise.
  const generationRef = useRef(0);

  const stopInterval = useCallback(() => {
    generationRef.current += 1;
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => stopInterval, [stopInterval]);

  // Leaving the draft that started the capture (selecting a different entry,
  // or starting a fresh new-entry draft) ends the phase — never silently,
  // and never lets a result land on whatever draft happens to be open when
  // a deferred clipboard match resolves.
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    if (!sessionChanged(sessionKeyRef.current, sessionKey)) return;
    sessionKeyRef.current = sessionKey;
    setDuplicate(null);
    capturedTextRef.current = null;
    pendingCredentialRef.current = null;
    if (capture) {
      stopInterval();
      setCapture(null);
      setMessage({ de: "Eintrag gewechselt. Erfassung abgebrochen.", en: "Entry changed. Capture cancelled." });
    }
  }, [sessionKey, capture, stopInterval]);

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

  // Switching the entry-kind tabs away from API hides the panel that could
  // show a match, so the capture must end right there too — never keep
  // polling (and never clear the clipboard on a match) for a draft that is
  // no longer an API draft.
  useEffect(() => {
    if (!isApiDraft && capture) {
      stopInterval();
      setCapture(null);
      setMessage({
        de: "Eintragsart gewechselt. Erfassung abgebrochen.",
        en: "Entry type changed. Capture cancelled.",
      });
    }
  }, [isApiDraft, capture, stopInterval]);

  const finishCapture = useCallback(
    (credential: DetectedCredential, capturedText: string) => {
      const duplicateMatch = findDuplicateKeyEntry(
        entriesRef.current,
        credential.provider,
        accountRef.current,
        credential.password,
      );
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
    [onCaptured],
  );

  const poll = useCallback(
    (active: CaptureState, generation: number) => {
      // Never issue a new clipboard read once the deadline has already
      // passed — the independent timeout below is what actually enforces
      // the bound when reads hang, this just avoids piling up more of them.
      if (isCaptureExpired(active, Date.now())) return;
      void readClipboardText()
        .catch(() => "")
        .then((text) => {
          // This read may have been in flight when the capture was
          // cancelled/stopped/superseded. Stale results are dropped
          // unapplied — stopInterval already bumped the generation.
          if (isStaleGeneration(generationRef.current, generation)) return;
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
    const generation = generationRef.current;
    intervalRef.current = setInterval(() => poll(next, generation), CAPTURE_POLL_MS);
    // Fires exactly at the deadline regardless of any in-flight or hung
    // clipboard read — the one thing that actually guarantees the capture
    // never outlives its advertised bounded window.
    timeoutRef.current = setTimeout(() => {
      if (isStaleGeneration(generationRef.current, generation)) return;
      stopInterval();
      setCapture(null);
      setMessage({
        de: "Zeit abgelaufen. Erfassung ist aus. Erneut starten, wenn nötig.",
        en: "Time ran out. Capture is off. Start again if needed.",
      });
    }, CAPTURE_TIMEOUT_MS);
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
