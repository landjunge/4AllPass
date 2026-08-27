import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDraft, newEntryId, type VaultEntry } from "../../lib/entries.ts";
import { filterVaultEntries } from "./search.ts";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return { id: newEntryId(), ...emptyDraft("web"), updatedAt: "2026-01-01T00:00:00.000Z", ...partial };
}

test("filterVaultEntries is a no-op for blank query", () => {
  const entries = [entry({ title: "GitHub" })];
  assert.equal(filterVaultEntries(entries, "  "), entries);
});

test("filterVaultEntries matches title username url provider host", () => {
  const github = entry({ title: "GitHub", username: "ada", url: "https://github.com", provider: "GitHub" });
  const ftp = entry({ kind: "sftp", title: "Backup", host: "ftp.example.com" });
  const entries = [github, ftp];
  assert.deepEqual(filterVaultEntries(entries, "ADA"), [github]);
  assert.deepEqual(filterVaultEntries(entries, "ftp.example"), [ftp]);
  assert.deepEqual(filterVaultEntries(entries, "nope"), []);
});
