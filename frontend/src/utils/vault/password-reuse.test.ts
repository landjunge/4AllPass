import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, generatePassword, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import { findExactPasswordReuseGroups } from "./password-reuse.ts";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return {
    id: newEntryId(),
    ...emptyDraft("web"),
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("groups entries that share the exact same password", () => {
  const shared = "Sunshine!42";
  const a = entry({ title: "Bank", url: "https://n26.com", password: shared });
  const b = entry({ title: "Forum", url: "https://forum.example", password: shared });
  const unrelated = entry({ title: "Mail", url: "https://gmail.com", password: generatePassword() });
  const groups = findExactPasswordReuseGroups([a, b, unrelated]);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0]?.entryIds), new Set([a.id, b.id]));
  assert.deepEqual(new Set(groups[0]?.titles), new Set(["Bank", "Forum"]));
});

test("a merely similar (not identical) password is not grouped", () => {
  const a = entry({ title: "One", password: "hunter2" });
  const b = entry({ title: "Two", password: "hunter3" });
  assert.equal(findExactPasswordReuseGroups([a, b]).length, 0);
});

test("entries without a password never form a group", () => {
  const a = entry({ title: "One", password: "" });
  const b = entry({ title: "Two", password: "" });
  assert.equal(findExactPasswordReuseGroups([a, b]).length, 0);
});

test("three entries sharing a password form one group of three, not three pairs", () => {
  const shared = "Sunshine!42";
  const a = entry({ title: "A", password: shared });
  const b = entry({ title: "B", password: shared });
  const c = entry({ title: "C", password: shared });
  const groups = findExactPasswordReuseGroups([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.entryIds.length, 3);
});

test("two records of the same service sharing a password are not a cross-service finding", () => {
  // #279 review: a duplicate login (same host + username), not two
  // independent accounts reusing a secret — that belongs to the existing
  // cleanup/similarity flow, not here.
  const shared = "Sunshine!42";
  const a = entry({ title: "GitHub (old)", url: "https://github.com", username: "me", password: shared });
  const b = entry({ title: "GitHub (copy)", url: "https://github.com", username: "me", password: shared });
  assert.equal(findExactPasswordReuseGroups([a, b]).length, 0);
});

test("a same-service duplicate plus a genuinely different service still reports the real cross-service pair", () => {
  const shared = "Sunshine!42";
  const dupeA = entry({ title: "GitHub (old)", url: "https://github.com", username: "me", password: shared });
  const dupeB = entry({ title: "GitHub (copy)", url: "https://github.com", username: "me", password: shared });
  const other = entry({ title: "Forum", url: "https://forum.example", username: "me", password: shared });
  const groups = findExactPasswordReuseGroups([dupeA, dupeB, other]);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0]?.entryIds), new Set([dupeA.id, dupeB.id, other.id]));
});

test("never includes a password value anywhere in the result", () => {
  const secret = "Tr0ub4dor&3-super-secret";
  const a = entry({ title: "A", password: secret });
  const b = entry({ title: "B", password: secret });
  const groups = findExactPasswordReuseGroups([a, b]);
  const serialized = JSON.stringify(groups);
  assert.ok(!serialized.includes(secret));
});
