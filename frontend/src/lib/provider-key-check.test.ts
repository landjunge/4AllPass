import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECKABLE_PROVIDERS,
  isCheckableProviderId,
  statusHint,
  statusLabel,
  suggestCheckableProvider,
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

test("checkProviderKeys outside a Tauri shell degrades to not_checkable for every item, never throws, never guesses valid", async () => {
  const results = await checkProviderKeys([
    { id: "a", providerId: "github", key: "synthetic-key-a" },
    { id: "b", providerId: "openai", key: "synthetic-key-b" },
  ]);
  assert.deepEqual(results, [
    { id: "a", status: "not_checkable", scopeHint: null },
    { id: "b", status: "not_checkable", scopeHint: null },
  ]);
});
