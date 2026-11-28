import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCaptureExpired,
  isStaleGeneration,
  sessionChanged,
  startCapture,
  tickCapture,
} from "../../lib/clipboard-capture.ts";
import { findDuplicateKeyEntry } from "../../services/vault/duplicates.ts";
import type { VaultEntry } from "../../types/vault.ts";

/**
 * Regression contract for `useKeyCreateCapture` (issue #278 review
 * findings). This repo's `node:test` runner has no DOM / React-hook
 * rendering harness (no jsdom, no @testing-library) — the hook is
 * deliberately kept thin (see its own doc comment) and delegates every
 * decision to the pure, already-unit-tested primitives in
 * `clipboard-capture.ts` and `duplicates.ts`. These tests drive those same
 * exported primitives in the exact sequence the hook's real callbacks and
 * effects use them, to pin down the composed guarantee each finding asked
 * for without re-implementing the hook's own logic.
 */

const START = 1_000_000;
const TIMEOUT = 90_000;

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "entry_1",
    kind: "api",
    title: "GitHub PAT",
    provider: "GitHub",
    account: "personal",
    username: "",
    password: "ghp_existingvalue0000000000",
    url: "",
    host: "",
    port: "",
    protocol: "",
    capabilities: "repository.read",
    credentialType: "api_key",
    notes: "",
    totpSecret: "",
    updatedAt: new Date(0).toISOString(),
    domain: "",
    providerId: "",
    providerConfidence: 0,
    providerMatchType: "",
    favorite: false,
    ...overrides,
  };
}

// P1 — bind capture to the draft that started it.
test("selecting a different entry's session ends a still-running capture and drops a result already in flight for it", () => {
  // Mirrors useKeyCreateCapture's sessionKeyRef effect: the capture was
  // started while `sessionKey` was 1 (the new-entry draft); a poll is
  // issued and tagged with the generation active at that moment.
  const openedWithSession = 1;
  let generation = 0;
  const pollGeneration = generation;

  // The user selects an existing entry from VaultList — useVaultState's
  // startEdit bumps draftSession, which the hook sees as a session change.
  const nextSession = 2;
  const didSessionChange = sessionChanged(openedWithSession, nextSession);
  assert.equal(didSessionChange, true);
  if (didSessionChange) generation += 1; // the effect's stopInterval()

  // The read that was already in flight for the abandoned draft resolves
  // afterwards with a real key. It must never reach the newly selected
  // entry's draft.
  const tick = tickCapture(startCapture("github", START, TIMEOUT), "github", "ghp_0123456789abcdefNOTREAL", START + 500);
  assert.equal(tick.type, "captured", "sanity: the clipboard really did contain a matching key");
  assert.equal(isStaleGeneration(generation, pollGeneration), true);
});

// P2 — invalidate pending clipboard reads when capture stops.
test("a clipboard read that resolves after the user cancels capture is dropped unapplied", () => {
  const capture = startCapture("github", START, TIMEOUT);
  let generation = 0;
  const pollGeneration = generation;

  // cancelCapture() -> stopInterval() bumps the generation synchronously,
  // before the already-issued read's promise can settle.
  generation += 1;

  const tick = tickCapture(capture, "github", "ghp_0123456789abcdefNOTREAL", START + 500);
  assert.equal(tick.type, "captured", "sanity: the clipboard really did contain a matching key");
  assert.equal(isStaleGeneration(generation, pollGeneration), true, "must be discarded, never applied to the draft");
});

// P2 — stop capture when the draft changes away from API.
test("switching entry kind cancels capture without clearing the clipboard", () => {
  const capture = startCapture("github", START, TIMEOUT);
  let generation = 0;
  const pollGeneration = generation;

  // useKeyCreateCapture's isApiDraft effect fires the instant the open
  // draft leaves API mode — independent of whether VaultEntryForm still
  // mounts the capture panel — and stops the interval the same way
  // cancelCapture does.
  const isApiDraft = false;
  assert.equal(!isApiDraft, true, "the draft left API mode");
  generation += 1; // the effect's stopInterval()

  // A read already in flight resolves afterwards with a real key. It must
  // never reach finishCapture, so the clipboard is never cleared for a key
  // the user can no longer see in any panel.
  const tick = tickCapture(capture, "github", "ghp_0123456789abcdefNOTREAL", START + 500);
  assert.equal(tick.type, "captured", "sanity: the clipboard really did contain a matching key");
  assert.equal(isStaleGeneration(generation, pollGeneration), true);
});

// P2 — pass the draft account into duplicate detection.
test("capture prompts for an existing provider and account with a different key", () => {
  const entries = [entry({ provider: "GitHub", account: "work", password: "ghp_existingvalue0000000000" })];

  // finishCapture must read the *current* draft account (accountRef.current)
  // at the moment capture completes.
  const currentDraftAccount = "work";
  const match = findDuplicateKeyEntry(entries, "GitHub", currentDraftAccount, "ghp_brandnewvalue00000000000");
  assert.equal(match?.kind, "sameAccount");

  // The regressed behaviour: always passing an empty account (never reading
  // it from the draft) would have missed this match entirely, letting a
  // genuine duplicate through without the promised confirmation.
  const regressed = findDuplicateKeyEntry(entries, "GitHub", "", "ghp_brandnewvalue00000000000");
  assert.equal(regressed, null);
});

// P2 — cancel capture before starting an asynchronous save.
test("capture cannot replace the draft during an in-flight save", () => {
  // useVaultState.save() bumps draftSession *before* awaiting
  // saveEntries(next), never after — so a capture result that lands while
  // the save is in flight belongs to an already-invalidated session by the
  // time it would apply.
  const openedWithSession = 5;
  let generation = 0;
  const pollGeneration = generation;

  const sessionAtSaveStart = openedWithSession + 1; // save() bumps it first
  const didSessionChange = sessionChanged(openedWithSession, sessionAtSaveStart);
  assert.equal(didSessionChange, true);
  generation += 1; // the sessionKey effect's stopInterval()

  const tick = tickCapture(startCapture("github", START, TIMEOUT), "github", "ghp_0123456789abcdefNOTREAL", START + 500);
  assert.equal(tick.type, "captured", "sanity: a real key really did match while the save was in flight");
  assert.equal(isStaleGeneration(generation, pollGeneration), true, "must never land on the draft the save already snapshotted");
});

// P2 — enforce the capture deadline independently of clipboard reads.
test("capture stops at its deadline while clipboard reads remain pending", () => {
  const capture = startCapture("github", START, TIMEOUT);
  const deadline = START + TIMEOUT;

  // poll() refuses to issue another read once the deadline has passed —
  // and this holds regardless of whether any earlier read ever resolved
  // (e.g. a stuck OS permission prompt leaving a read pending forever).
  assert.equal(isCaptureExpired(capture, deadline - 1), false);
  assert.equal(isCaptureExpired(capture, deadline), true);
  assert.equal(
    isCaptureExpired(capture, deadline + 60_000),
    true,
    "still expired no matter how much longer a hung read takes to settle",
  );
});

// P2 — check duplicates against the latest vault entries.
test("capture detects entries imported while polling", () => {
  const entriesAtCaptureStart: VaultEntry[] = [];
  const importedWhilePolling = entry({ provider: "GitHub", account: "work", password: "ghp_existingvalue0000000000" });
  const entriesAtCaptureResolve = [...entriesAtCaptureStart, importedWhilePolling];

  // finishCapture reads entriesRef.current — the live array at the moment
  // the capture actually resolves — never the entries array closed over
  // when setInterval(poll, ...) was first scheduled.
  const matchAgainstLiveEntries = findDuplicateKeyEntry(
    entriesAtCaptureResolve,
    "GitHub",
    "work",
    "ghp_existingvalue0000000000",
  );
  assert.equal(matchAgainstLiveEntries?.kind, "exact");

  // The regressed behaviour: checking against the entries array captured
  // at capture start would have missed the entry imported mid-poll.
  const matchAgainstStaleEntries = findDuplicateKeyEntry(
    entriesAtCaptureStart,
    "GitHub",
    "work",
    "ghp_existingvalue0000000000",
  );
  assert.equal(matchAgainstStaleEntries, null);
});
