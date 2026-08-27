import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, generatePassword, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import { classifyEntry } from "./category.ts";
import {
  groupVaultSections,
  levenshtein,
  localEntryHealth,
  mergeLeaked,
  weightedHealthScore,
} from "./health.ts";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return {
    id: newEntryId(),
    ...emptyDraft("web"),
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("levenshtein is zero for identical strings and small for near-duplicates", () => {
  assert.equal(levenshtein("hunter2", "hunter2"), 0);
  assert.equal(levenshtein("hunter2", "hunter3"), 1);
});

test("classifyEntry weights bank above social from the host", () => {
  assert.equal(classifyEntry(entry({ url: "https://n26.com/login" })), "bank");
  assert.equal(classifyEntry(entry({ url: "https://instagram.com/" })), "social");
});

test("weightedHealthScore stays null under five entries", () => {
  const rows = localEntryHealth([entry({ password: "short" })]);
  assert.equal(weightedHealthScore(rows), null);
});

test("a leaked bank secret drops the score more than a weak social secret", () => {
  const strong = generatePassword();
  const bank = entry({ url: "https://n26.com", password: strong });
  const mail = entry({ url: "https://gmail.com", password: generatePassword() });
  const shop = entry({ url: "https://amazon.de", password: generatePassword() });
  const clinic = entry({ title: "Apotheke", password: generatePassword() });
  const social = entry({ url: "https://instagram.com", password: "abc" });
  const extra = entry({ title: "Forum", password: generatePassword() });
  const local = localEntryHealth([bank, mail, shop, clinic, social, extra]);
  const withLeak = mergeLeaked(local, new Set([bank.id]));
  const leakScore = weightedHealthScore(withLeak);
  const weakOnly = weightedHealthScore(local);
  assert.ok(leakScore !== null && weakOnly !== null);
  assert.ok(leakScore < weakOnly);
});

test("groupVaultSections puts favorites first then at-risk then recent", () => {
  const star = entry({ title: "Star", favorite: true, updatedAt: "2026-01-02T00:00:00.000Z" });
  const weak = entry({ title: "Weak", password: "abc", updatedAt: "2026-01-03T00:00:00.000Z" });
  const ok = entry({ title: "Ok", password: generatePassword(), updatedAt: "2026-01-04T00:00:00.000Z" });
  const health = localEntryHealth([star, weak, ok]);
  const groups = groupVaultSections([star, weak, ok], health);
  assert.deepEqual(
    groups.favorites.map((row) => row.title),
    ["Star"],
  );
  assert.deepEqual(
    groups.attention.map((row) => row.title),
    ["Weak"],
  );
  assert.deepEqual(
    groups.recent.map((row) => row.title),
    ["Ok"],
  );
});
