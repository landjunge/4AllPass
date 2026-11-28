import assert from "node:assert/strict";
import { test } from "node:test";

import { describeExpiry } from "./key-expiry.ts";

const t = ({ de }: { de: string; en: string }): string => de;
const now = new Date("2026-11-28T00:00:00.000Z");

test("unknown expiry never invents a date", () => {
  const result = describeExpiry({ kind: "unknown" }, t, now);
  assert.equal(result.tone, "unknown");
  assert.match(result.label, /unbekannt/i);
});

test("a known future date beyond the warn window shows plainly", () => {
  const result = describeExpiry({ kind: "known", expiresAt: "2027-06-01T00:00:00.000Z" }, t, now);
  assert.equal(result.tone, "ok");
  assert.match(result.label, /Läuft ab am/);
});

test("a known date inside the warn window surfaces a day-count reminder", () => {
  const result = describeExpiry({ kind: "known", expiresAt: "2026-12-05T00:00:00.000Z" }, t, now);
  assert.equal(result.tone, "warn");
  assert.match(result.label, /Läuft in 7 Tagen ab/);
});

test("a known past date is recognized as already expired", () => {
  const result = describeExpiry({ kind: "known", expiresAt: "2026-01-01T00:00:00.000Z" }, t, now);
  assert.equal(result.tone, "expired");
  assert.match(result.label, /Abgelaufen am/);
});

test("expiring exactly at the current instant is reported as expiring today, not already expired", () => {
  const result = describeExpiry({ kind: "known", expiresAt: now.toISOString() }, t, now);
  assert.equal(result.tone, "expired");
  assert.match(result.label, /heute/);
});

test("a date a few hours in the past (previous calendar day) is expired, not expiring today", () => {
  // now = 2026-11-28T00:00:00Z; expiry was yesterday, 13h before now.
  const result = describeExpiry({ kind: "known", expiresAt: "2026-11-27T11:00:00.000Z" }, t, now);
  assert.equal(result.tone, "expired");
  assert.match(result.label, /Abgelaufen am/);
  assert.doesNotMatch(result.label, /heute/);
});

test("an unparseable known date degrades to unknown rather than throwing or guessing", () => {
  const result = describeExpiry({ kind: "known", expiresAt: "not-a-date" }, t, now);
  assert.equal(result.tone, "unknown");
});
