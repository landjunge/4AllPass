import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, type VaultEntry } from "../../lib/entries.ts";
import {
  DEFAULT_STALE_AFTER_DAYS,
  previewCleanup,
  runMatchesEntries,
  type CleanupRun,
  type SimilarGroup,
  type StaleFinding,
} from "./cleanup.ts";

function entry(partial: Partial<VaultEntry> & { id: string }): VaultEntry {
  return {
    ...emptyDraft("web"),
    id: partial.id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const FIXED_NOW = new Date("2026-11-12T00:00:00.000Z");

test("no similar groups and no stale entries yields an empty preview", () => {
  const rows = [
    entry({ id: "a", host: "github.com", username: "me", password: "pw", updatedAt: "2026-11-01T00:00:00.000Z" }),
    entry({ id: "b", host: "gitlab.com", username: "me", password: "pw", updatedAt: "2026-11-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.summary, { similarGroups: 0, stale: 0 });
});

test("same exact service and identity group as a similarity candidate without any removal recommendation", () => {
  const rows = [
    entry({ id: "old", host: "github.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "new", host: "github.com", username: "me", password: "pw", updatedAt: "2026-06-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const group = result.findings.find((f): f is SimilarGroup => f.kind === "similar");
  assert.ok(group);
  assert.deepEqual(group.entryIds, ["new", "old"]);
  assert.equal(group.host, "github.com");
  assert.equal(group.identity, "me");
  assert.equal(result.summary.similarGroups, 1);
  // No removal vocabulary anywhere in the result.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("remove"), false);
  assert.equal(serialized.includes("keep"), false);
  assert.equal(serialized.includes("removable"), false);
});

test("same password but different notes or totpSecret is still only a candidate, never removable", () => {
  const rows = [
    entry({ id: "a", host: "github.com", username: "me", password: "pw", notes: "first note", totpSecret: "AAA", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "github.com", username: "me", password: "pw", notes: "second note", totpSecret: "BBB", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 1);
  const group = result.findings.find((f): f is SimilarGroup => f.kind === "similar");
  assert.ok(group);
  assert.deepEqual(group.entryIds, ["b", "a"]);
});

test("www is preserved: www.example.com and example.com are different services", () => {
  const rows = [
    entry({ id: "a", host: "www.example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "example.com", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("different URL ports are different services", () => {
  const rows = [
    entry({ id: "a", url: "https://example.com:8443/login", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", url: "https://example.com/login", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("web boundary prefers URL hostname over domain metadata (www vs bare)", () => {
  const rows = [
    entry({ id: "a", url: "https://www.example.com/login", domain: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", url: "https://example.com/login", domain: "example.com", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("different URL protocols are different services", () => {
  const rows = [
    entry({ id: "a", url: "http://example.com/login", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", url: "https://example.com/login", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("different kind, protocol or port are separate services", () => {
  const web = entry({ id: "w", kind: "web", host: "github.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" });
  const sftp = entry({ id: "s", kind: "sftp", host: "github.com", username: "me", password: "pw", port: "22", protocol: "sftp", updatedAt: "2026-01-01T00:00:00.000Z" });
  const sftpOtherPort = entry({ id: "s2", kind: "sftp", host: "github.com", username: "me", password: "pw", port: "2222", protocol: "sftp", updatedAt: "2026-01-01T00:00:00.000Z" });
  const ftp = entry({ id: "f", kind: "sftp", host: "github.com", username: "me", password: "pw", port: "22", protocol: "ftp", updatedAt: "2026-01-01T00:00:00.000Z" });
  const result = previewCleanup([web, sftp, sftpOtherPort, ftp], { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("identity case is preserved: Alice and alice are not grouped", () => {
  const rows = [
    entry({ id: "a", host: "sftp.example.com", username: "Alice", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "sftp.example.com", username: "alice", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("different usernames on the same host are not grouped", () => {
  const rows = [
    entry({ id: "a", host: "github.com", username: "alice", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "github.com", username: "bob", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("empty host or empty identity never forms a group", () => {
  const rows = [
    entry({ id: "noHost", host: "", url: "", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "noUser", host: "example.com", username: "", account: "", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "full", host: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 0);
});

test("account is used as identity fallback when username is empty", () => {
  const rows = [
    entry({ id: "a", host: "api.example.com", username: "", account: "ops", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "api.example.com", username: "", account: "ops", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 1);
});

test("stale entries older than the threshold are flagged, recent are not", () => {
  const rows = [
    entry({ id: "old", host: "example.com", username: "me", password: "pw", updatedAt: "2025-01-01T00:00:00.000Z" }),
    entry({ id: "fresh", host: "example.org", username: "me", password: "pw", updatedAt: "2026-10-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const stale = result.findings.filter((f): f is StaleFinding => f.kind === "stale");
  assert.deepEqual(
    stale.map((finding) => finding.entryId),
    ["old"],
  );
  assert.ok(stale[0]!.ageDays > DEFAULT_STALE_AFTER_DAYS);
  assert.equal(result.summary.stale, 1);
});

test("stale threshold boundary is inclusive and age is measured in whole days", () => {
  const rows = [
    entry({ id: "exact", host: "example.com", username: "me", password: "pw", updatedAt: "2026-10-13T00:00:00.000Z" }),
    entry({ id: "justUnder", host: "example.org", username: "me", password: "pw", updatedAt: "2026-10-14T00:00:00.000Z" }),
  ];
  // 30 days before FIXED_NOW is 2026-10-13 -> exactly stale; 29 days -> not.
  const result = previewCleanup(rows, { now: FIXED_NOW, staleAfterDays: 30 });
  const stale = result.findings.filter((f): f is StaleFinding => f.kind === "stale");
  assert.deepEqual(
    stale.map((finding) => finding.entryId),
    ["exact"],
  );
  assert.equal(stale[0]!.ageDays, 30);
});

test("preview never copies secret values into a similar finding", () => {
  const rows = [
    entry({
      id: "a",
      host: "example.com",
      username: "me",
      password: "PASSWORD_MARKER",
      notes: "NOTES_MARKER",
      totpSecret: "TOTP_MARKER",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    entry({ id: "b", host: "example.com", username: "me", password: "PASSWORD_MARKER", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(result.summary.similarGroups, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("PASSWORD_MARKER"), false);
  assert.equal(serialized.includes("NOTES_MARKER"), false);
  assert.equal(serialized.includes("TOTP_MARKER"), false);
});

test("preview never copies secret values into a stale finding", () => {
  const rows = [
    entry({
      id: "a",
      host: "example.com",
      username: "me",
      password: "PASSWORD_MARKER",
      notes: "NOTES_MARKER",
      totpSecret: "TOTP_MARKER",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("PASSWORD_MARKER"), false);
  assert.equal(serialized.includes("NOTES_MARKER"), false);
  assert.equal(serialized.includes("TOTP_MARKER"), false);
});

test("candidate ordering compares parsed timestamps, not ISO string order", () => {
  const rows = [
    entry({ id: "a", host: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000+02:00" }),
    entry({ id: "b", host: "example.com", username: "me", password: "pw", updatedAt: "2025-12-31T23:00:00.000Z" }),
  ];
  // a == 2025-12-31T22:00Z, b == 2025-12-31T23:00Z -> b is newer even though its string sorts first.
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const group = result.findings.find((f): f is SimilarGroup => f.kind === "similar");
  assert.ok(group);
  assert.deepEqual(group.entryIds, ["b", "a"]);
});

test("invalid updatedAt is treated as oldest and never stale", () => {
  const rows = [
    entry({ id: "valid", host: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "garbage", host: "example.com", username: "me", password: "pw", updatedAt: "not-a-date" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const group = result.findings.find((f): f is SimilarGroup => f.kind === "similar");
  assert.ok(group);
  assert.deepEqual(group.entryIds, ["valid", "garbage"]);
  assert.equal(result.summary.stale, 0);
});

test("preview does not mutate the input array or its entries", () => {
  const rows = [
    entry({ id: "a", host: "example.com", username: "me", password: "secret", updatedAt: "2025-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "example.com", username: "me", password: "secret", updatedAt: "2025-02-01T00:00:00.000Z" }),
  ];
  const before = JSON.stringify(rows);
  previewCleanup(rows, { now: FIXED_NOW });
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rows.length, 2);
});

test("equal updatedAt breaks ties by the smaller id for deterministic ordering", () => {
  const rows = [
    entry({ id: "b", host: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "a", host: "example.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  const result = previewCleanup(rows, { now: FIXED_NOW });
  const group = result.findings.find((f): f is SimilarGroup => f.kind === "similar");
  assert.ok(group);
  assert.deepEqual(group.entryIds, ["a", "b"]);
});

test("a computed preview is discarded when the entry set changes (restore)", () => {
  const before = [
    entry({ id: "a", host: "github.com", username: "me", password: "pw", updatedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: "b", host: "github.com", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const run: CleanupRun = { entries: before, preview: previewCleanup(before, { now: FIXED_NOW }) };
  assert.equal(runMatchesEntries(run, before), true, "same entry set keeps the preview");
  // A history restore replaces the array with different entries.
  const restored = [
    entry({ id: "c", host: "gitlab.com", username: "me", password: "pw", updatedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  assert.equal(runMatchesEntries(run, restored), false, "changed entries discard the preview");
});

test("a stored empty result is discarded after a restore too", () => {
  const before = [entry({ id: "only", host: "solo.example", username: "me", password: "pw", updatedAt: "2026-10-01T00:00:00.000Z" })];
  const run: CleanupRun = { entries: before, preview: previewCleanup(before, { now: FIXED_NOW }) };
  assert.equal(run.preview.findings.length, 0, "sanity: a single entry yields no candidates");
  const restored = [entry({ id: "other", host: "solo.example", username: "me", password: "pw", updatedAt: "2026-10-01T00:00:00.000Z" })];
  assert.equal(runMatchesEntries(run, restored), false, "an empty result must also be discarded on change");
});

test("runMatchesEntries is null-safe and binds by array reference", () => {
  assert.equal(runMatchesEntries(null, []), false);
  const entries = [entry({ id: "a", host: "x.example", username: "u", password: "p", updatedAt: "2026-01-01T00:00:00.000Z" })];
  const run: CleanupRun = { entries, preview: previewCleanup(entries, { now: FIXED_NOW }) };
  assert.equal(runMatchesEntries(run, entries), true);
  // Immutable replacement with equal content still counts as a change.
  const equalContent = [entry({ id: "a", host: "x.example", username: "u", password: "p", updatedAt: "2026-01-01T00:00:00.000Z" })];
  assert.equal(runMatchesEntries(run, equalContent), false);
});
