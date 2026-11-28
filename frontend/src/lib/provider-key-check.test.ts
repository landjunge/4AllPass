import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECKABLE_PROVIDERS,
  currentResultFor,
  isCheckableProviderId,
  statusHint,
  statusLabel,
  suggestCheckableProvider,
  type ProviderKeyCheckRecord,
  type ProviderKeyCheckStatus,
} from "./provider-key-check.ts";
import { checkProviderKeys } from "../modules/desktop-adapter/index.ts";

const t = ({ de }: { de: string; en: string }): string => de;

test("suggestCheckableProvider matches an exact provider id or display name", () => {
  assert.equal(suggestCheckableProvider("github"), "github");
  assert.equal(suggestCheckableProvider("GitHub"), "github");
  assert.equal(suggestCheckableProvider("  OpenAI  "), "openai");
  assert.equal(suggestCheckableProvider("Stripe"), "stripe");
});

test("suggestCheckableProvider never guesses from a similar-looking name", () => {
  assert.equal(suggestCheckableProvider("GitHub Enterprise"), null);
  assert.equal(suggestCheckableProvider("OpenAI-compatible proxy"), null);
  assert.equal(suggestCheckableProvider("DeepSeek"), null);
  assert.equal(suggestCheckableProvider("OpenRouter"), null);
  assert.equal(suggestCheckableProvider(""), null);
  assert.equal(suggestCheckableProvider("   "), null);
});

test("isCheckableProviderId accepts only the three covered providers", () => {
  for (const provider of CHECKABLE_PROVIDERS) {
    assert.ok(isCheckableProviderId(provider.id));
  }
  assert.equal(isCheckableProviderId("deepseek"), false);
  assert.equal(isCheckableProviderId("openrouter"), false);
  assert.equal(isCheckableProviderId("minimax"), false);
  assert.equal(isCheckableProviderId("nvidia"), false);
  assert.equal(isCheckableProviderId("cloudflare"), false);
});

test("every status has a non-empty label and never echoes a key-shaped string", () => {
  const statuses: ProviderKeyCheckStatus[] = [
    "valid",
    "invalid",
    "insufficient_permission",
    "quota_exceeded",
    "unreachable",
    "not_checkable",
  ];
  for (const status of statuses) {
    const label = statusLabel(status, t);
    assert.ok(label.length > 0, status);
    assert.doesNotMatch(label, /sk-|ghp_|sk_live|sk_test/);
    const hint = statusHint(status, t);
    assert.doesNotMatch(hint, /sk-|ghp_|sk_live|sk_test/);
  }
});

test("403/429 labels never claim the key is invalid", () => {
  assert.doesNotMatch(statusLabel("insufficient_permission", t), /ungültig/i);
  assert.doesNotMatch(statusLabel("quota_exceeded", t), /ungültig/i);
  // The hints may explain *why* this is not proof of invalidity (and so may
  // mention the word), but must not assert invalidity outright.
  assert.doesNotMatch(statusHint("insufficient_permission", t), /\bist ungültig\b/i);
  assert.doesNotMatch(statusHint("quota_exceeded", t), /\bist ungültig\b/i);
});

function record(providerId: ProviderKeyCheckRecord["providerId"]): ProviderKeyCheckRecord {
  return {
    providerId,
    status: "valid",
    scopeHint: null,
    expiry: { kind: "unknown" },
    checkedAt: "2026-11-27T00:00:00.000Z",
  };
}

// VaultKeyCheckPanel (issue #277 finding 2): the panel used to key results
// only by vault-entry id, so an old "Valid" from a GitHub check stayed
// visible after the dropdown was switched to OpenAI, which was never
// checked. `currentResultFor` is the single gate the panel calls before
// rendering a result, and must refuse a result whose own `providerId`
// does not match what is currently selected — covering both an ordinary
// dropdown switch after a finished check and a reply that arrives late,
// after the dropdown already moved on to a different provider mid-check.
test("currentResultFor shows a result only while its provider is still selected", () => {
  const githubResult = record("github");
  assert.equal(currentResultFor(githubResult, "github"), githubResult);
  assert.equal(currentResultFor(githubResult, "openai"), undefined, "switched dropdown must hide the stale result");
  assert.equal(currentResultFor(githubResult, ""), undefined, "no provider selected must hide any result");
  assert.equal(currentResultFor(undefined, "github"), undefined);
});

test("currentResultFor hides a late reply that lands after the dropdown moved to a different provider", () => {
  // Simulates: user checks GitHub, switches the dropdown to OpenAI before
  // the GitHub reply arrives, then the GitHub reply lands and gets stored.
  const lateGithubReply = record("github");
  const selectedAtArrivalTime: ProviderKeyCheckRecord["providerId"] = "openai";
  assert.equal(
    currentResultFor(lateGithubReply, selectedAtArrivalTime),
    undefined,
    "a late reply for the old provider must never appear next to the newly selected one",
  );
});

test("checkProviderKeys outside a Tauri shell degrades to not_checkable for every item, never throws, never guesses valid", async () => {
  const results = await checkProviderKeys([
    { id: "a", providerId: "github", key: "synthetic-key-a" },
    { id: "b", providerId: "openai", key: "synthetic-key-b" },
  ]);
  assert.deepEqual(results, [
    { id: "a", status: "not_checkable", scopeHint: null, expiry: { kind: "unknown" } },
    { id: "b", status: "not_checkable", scopeHint: null, expiry: { kind: "unknown" } },
  ]);
});
