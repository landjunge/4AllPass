import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import { removeEntryById, upsertDraft } from "./entries.ts";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return { id: newEntryId(), ...emptyDraft("web"), updatedAt: "2026-01-01T00:00:00.000Z", ...partial };
}

test("upsertDraft appends when nothing is selected", () => {
  const existing = [entry({ title: "Old" })];
  const next = upsertDraft(existing, emptyDraft("web"), null);
  assert.equal(next.length, 2);
  assert.equal(next[0]?.title, "Old");
  assert.ok(next[1]?.id.startsWith("entry_"));
});

test("upsertDraft replaces the selected row", () => {
  const current = entry({ title: "Old", username: "ada" });
  const draft = { ...emptyDraft("web"), title: "New", username: "ada" };
  const next = upsertDraft([current], draft, current.id);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.title, "New");
  assert.equal(next[0]?.id, current.id);
});

test("removeEntryById drops only that row", () => {
  const keep = entry({ title: "Keep" });
  const drop = entry({ title: "Drop" });
  assert.deepEqual(removeEntryById([keep, drop], drop.id), [keep]);
});
