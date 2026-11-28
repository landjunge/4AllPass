import assert from "node:assert/strict";
import { test } from "node:test";

import { isRotatableProviderId, isUnchangedKey, rotatableProviderFor } from "./key-rotation.ts";
import { emptyDraft, newEntryId, type VaultEntry } from "./entries.ts";

function apiEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: newEntryId(),
    ...emptyDraft("api"),
    password: "the-current-key",
    updatedAt: "2026-11-27T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

test("rotatableProviderFor matches an exact provider id or display name, never a guess", () => {
  assert.equal(rotatableProviderFor("GitHub"), "github");
  assert.equal(rotatableProviderFor("openai"), "openai");
  assert.equal(rotatableProviderFor("  Stripe  "), "stripe");
  assert.equal(rotatableProviderFor("GitHub Enterprise"), null);
  assert.equal(rotatableProviderFor("DeepSeek"), null);
  assert.equal(rotatableProviderFor(""), null);
});

test("isRotatableProviderId accepts only the ids the clipboard-capture flow also knows", () => {
  assert.ok(isRotatableProviderId("github"));
  assert.ok(isRotatableProviderId("openai"));
  assert.ok(isRotatableProviderId("stripe"));
  assert.equal(isRotatableProviderId("deepseek"), false);
});

test("isUnchangedKey flags a captured value identical to the entry's current key", () => {
  const entry = apiEntry({ password: "ghp_same" });
  assert.equal(isUnchangedKey(entry, "ghp_same"), true);
  assert.equal(isUnchangedKey(entry, "ghp_different"), false);
});

test("isUnchangedKey never claims a match against an empty stored key", () => {
  const entry = apiEntry({ password: "" });
  assert.equal(isUnchangedKey(entry, ""), false);
});
