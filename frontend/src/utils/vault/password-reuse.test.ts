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

test("never includes a password value anywhere in the result", () => {
  const secret = "Tr0ub4dor&3-super-secret";
  const a = entry({ title: "A", password: secret });
  const b = entry({ title: "B", password: secret });
  const groups = findExactPasswordReuseGroups([a, b]);
  const serialized = JSON.stringify(groups);
  assert.ok(!serialized.includes(secret));
});
