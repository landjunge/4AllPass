import assert from "node:assert/strict";
import { test } from "node:test";

import { findDuplicateKeyEntry } from "./duplicates.ts";
import type { VaultEntry } from "../../types/vault.ts";

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

test("finds an exact duplicate: same provider, same key value already stored", () => {
  const entries = [entry()];
  const match = findDuplicateKeyEntry(entries, "GitHub", "personal", "ghp_existingvalue0000000000");
  assert.equal(match?.kind, "exact");
  assert.equal(match?.entry.id, "entry_1");
});

test("provider name match is case-insensitive", () => {
  const entries = [entry()];
  const match = findDuplicateKeyEntry(entries, "github", "personal", "ghp_existingvalue0000000000");
  assert.equal(match?.kind, "exact");
});

test("falls back to a same-account match when the key value differs", () => {
  const entries = [entry()];
  const match = findDuplicateKeyEntry(entries, "GitHub", "personal", "ghp_brandnewvalue00000000000");
  assert.equal(match?.kind, "sameAccount");
  assert.equal(match?.entry.id, "entry_1");
});

test("a different provider is never flagged as a duplicate", () => {
  const entries = [entry({ provider: "GitHub" })];
  assert.equal(findDuplicateKeyEntry(entries, "OpenAI", "personal", "ghp_existingvalue0000000000"), null);
});

test("a different account at the same provider with a new key is not a duplicate", () => {
  const entries = [entry({ account: "personal" })];
  assert.equal(findDuplicateKeyEntry(entries, "GitHub", "work", "ghp_brandnewvalue00000000000"), null);
});

test("web and sftp entries are never matched — only api entries", () => {
  const entries = [entry({ kind: "web", password: "ghp_existingvalue0000000000" })];
  assert.equal(findDuplicateKeyEntry(entries, "GitHub", "personal", "ghp_existingvalue0000000000"), null);
});

test("an empty vault has no duplicates", () => {
  assert.equal(findDuplicateKeyEntry([], "GitHub", "personal", "ghp_existingvalue0000000000"), null);
});
