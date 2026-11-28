import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canStartCapture,
  isCaptureExpired,
  providerChangedDuringCapture,
  remainingSeconds,
  startCapture,
  tickCapture,
} from "./clipboard-capture.ts";

const START = 1_000_000;
const TIMEOUT = 90_000;

test("a fresh capture is not expired and has the full timeout remaining", () => {
  const capture = startCapture("github", START, TIMEOUT);
  assert.equal(isCaptureExpired(capture, START), false);
  assert.equal(remainingSeconds(capture, START), 90);
});

test("tickCapture reports expired once the deadline has passed", () => {
  const capture = startCapture("github", START, TIMEOUT);
  const tick = tickCapture(capture, "github", "ghp_0123456789abcdefNOTREAL", START + TIMEOUT + 1);
  assert.deepEqual(tick, { type: "expired" });
});

test("tickCapture reports expired (ends the phase) when the provider changed mid-capture", () => {
  const capture = startCapture("github", START, TIMEOUT);
  const tick = tickCapture(capture, "openai", "ghp_0123456789abcdefNOTREAL", START + 1_000);
  assert.deepEqual(tick, { type: "expired" });
});

test("tickCapture reports empty for an empty clipboard", () => {
  const capture = startCapture("github", START, TIMEOUT);
  assert.deepEqual(tickCapture(capture, "github", "", START + 1_000), { type: "empty" });
  assert.deepEqual(tickCapture(capture, "github", "   ", START + 1_000), { type: "empty" });
});

test("tickCapture reports not-a-key for ordinary clipboard content", () => {
  const capture = startCapture("github", START, TIMEOUT);
  assert.deepEqual(tickCapture(capture, "github", "lunch at noon?", START + 1_000), { type: "not-a-key" });
});

test("tickCapture reports not-a-key when the clipboard holds a different provider's key shape", () => {
  const capture = startCapture("github", START, TIMEOUT);
  const tick = tickCapture(capture, "github", "sk-0123456789abcdefNOTREAL0123456789", START + 1_000);
  assert.deepEqual(tick, { type: "not-a-key" });
});

test("tickCapture reports captured for a matching provider key", () => {
  const capture = startCapture("github", START, TIMEOUT);
  const tick = tickCapture(capture, "github", "ghp_0123456789abcdefNOTREAL", START + 1_000);
  assert.equal(tick.type, "captured");
  if (tick.type === "captured") assert.equal(tick.credential.provider, "GitHub");
});

test("canStartCapture refuses a locked vault even with a provider chosen", () => {
  assert.equal(canStartCapture("github", true), false);
});

test("canStartCapture refuses with no provider chosen", () => {
  assert.equal(canStartCapture("", false), false);
});

test("canStartCapture allows an unlocked vault with a provider chosen", () => {
  assert.equal(canStartCapture("github", false), true);
});

test("providerChangedDuringCapture flags any switch away from the capturing provider", () => {
  const capture = startCapture("github", START, TIMEOUT);
  assert.equal(providerChangedDuringCapture(capture, "github"), false);
  assert.equal(providerChangedDuringCapture(capture, "openai"), true);
  assert.equal(providerChangedDuringCapture(capture, ""), true);
});
