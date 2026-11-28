import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import {
  activeEntries,
  idAfterUpsert,
  purgeExpiredTrash,
  purgeTrashedEntryById,
  removeEntryById,
  restoreEntryFromTrashById,
  softDeleteEntryById,
  trashedEntries,
  upsertDraft,
} from "./entries.ts";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return {
    id: newEntryId(),
    ...emptyDraft("web"),
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...partial,
  };
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

test("idAfterUpsert keeps the selected row", () => {
  const current = entry({ title: "Old" });
  const next = upsertDraft([current], { ...emptyDraft("web"), title: "New" }, current.id);
  assert.equal(idAfterUpsert([current], next, current.id), current.id);
});

test("idAfterUpsert returns the appended id", () => {
  const existing = [entry({ title: "Old" })];
  const next = upsertDraft(existing, emptyDraft("web"), null);
  assert.equal(idAfterUpsert(existing, next, null), next[1]?.id);
});

test("removeEntryById drops only that row", () => {
  const keep = entry({ title: "Keep" });
  const drop = entry({ title: "Drop" });
  assert.deepEqual(removeEntryById([keep, drop], drop.id), [keep]);
});

// P0 #279 "Papierkorb" — soft delete / restore / purge.

test("softDeleteEntryById marks the entry without removing it", () => {
  const keep = entry({ title: "Keep" });
  const drop = entry({ title: "Drop" });
  const next = softDeleteEntryById([keep, drop], drop.id, "2026-02-01T00:00:00.000Z");
  assert.equal(next.length, 2, "nothing is removed by a soft delete");
  const trashed = next.find((row) => row.id === drop.id);
  assert.equal(trashed?.deletedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(trashed?.updatedAt, "2026-02-01T00:00:00.000Z");
  const untouched = next.find((row) => row.id === keep.id);
  assert.equal(untouched?.deletedAt, null);
});

test("softDeleteEntryById is a no-op for an id that is already trashed or missing", () => {
  const already = entry({ title: "Already", deletedAt: "2026-01-15T00:00:00.000Z" });
  const next = softDeleteEntryById([already], already.id, "2026-02-01T00:00:00.000Z");
  assert.equal(next[0]?.deletedAt, "2026-01-15T00:00:00.000Z", "a second soft delete does not move the timestamp");
  assert.deepEqual(softDeleteEntryById([already], "missing"), [already]);
});

test("activeEntries and trashedEntries partition by deletedAt", () => {
  const live = entry({ title: "Live" });
  const trashed = entry({ title: "Trashed", deletedAt: "2026-01-10T00:00:00.000Z" });
  assert.deepEqual(activeEntries([live, trashed]), [live]);
  assert.deepEqual(trashedEntries([live, trashed]), [trashed]);
});

test("restoreEntryFromTrashById clears deletedAt and only for a trashed entry", () => {
  const trashed = entry({ title: "Trashed", deletedAt: "2026-01-10T00:00:00.000Z" });
  const live = entry({ title: "Live" });
  const next = restoreEntryFromTrashById([trashed, live], trashed.id, "2026-02-01T00:00:00.000Z");
  assert.equal(next.find((row) => row.id === trashed.id)?.deletedAt, null);
  assert.equal(next.find((row) => row.id === live.id)?.updatedAt, live.updatedAt, "a live entry is left alone");
  // Restoring an already-live entry (or an unknown id) changes nothing.
  assert.deepEqual(restoreEntryFromTrashById([live], live.id), [live]);
});

test("purgeTrashedEntryById removes only a trashed match; a live entry with that id survives", () => {
  const trashed = entry({ title: "Gone", deletedAt: "2026-01-10T00:00:00.000Z" });
  const live = entry({ title: "Stays" });
  assert.deepEqual(purgeTrashedEntryById([trashed, live], trashed.id), [live]);
  // purge is conscious and final: it refuses to touch an entry that is not in the trash.
  assert.deepEqual(purgeTrashedEntryById([live], live.id), [live]);
});

test("purgeExpiredTrash does nothing while retentionDays is null or non-positive", () => {
  const trashed = entry({ title: "Old", deletedAt: "2000-01-01T00:00:00.000Z" });
  assert.deepEqual(purgeExpiredTrash([trashed], null), [trashed]);
  assert.deepEqual(purgeExpiredTrash([trashed], 0), [trashed]);
  assert.deepEqual(purgeExpiredTrash([trashed], -5), [trashed]);
});

test("purgeExpiredTrash drops only trashed entries older than the retention window", () => {
  const now = new Date("2026-02-10T00:00:00.000Z");
  const fresh = entry({ title: "Fresh", deletedAt: "2026-02-09T00:00:00.000Z" });
  const stale = entry({ title: "Stale", deletedAt: "2026-01-01T00:00:00.000Z" });
  const live = entry({ title: "Live" });
  const next = purgeExpiredTrash([fresh, stale, live], 7, now);
  assert.deepEqual(next, [fresh, live]);
});

test("purgeExpiredTrash never touches a live (non-trashed) entry", () => {
  const live = entry({ title: "Live" });
  assert.deepEqual(purgeExpiredTrash([live], 1, new Date("2099-01-01T00:00:00.000Z")), [live]);
});
