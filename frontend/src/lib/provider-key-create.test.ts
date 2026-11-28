import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectProviderKey,
  isKeyCreateProviderId,
  KEY_CREATE_PROVIDERS,
  keyCreateProviderName,
} from "./provider-key-create.ts";

test("isKeyCreateProviderId accepts only the three covered providers", () => {
  for (const provider of KEY_CREATE_PROVIDERS) {
    assert.ok(isKeyCreateProviderId(provider.id));
  }
  assert.equal(isKeyCreateProviderId("deepseek"), false);
  assert.equal(isKeyCreateProviderId("openrouter"), false);
  assert.equal(isKeyCreateProviderId(""), false);
});

test("detectProviderKey recognizes a key that matches the selected provider's shape", () => {
  const github = detectProviderKey("github", "ghp_0123456789abcdefNOTREAL");
  assert.ok(github);
  assert.equal(github?.provider, "GitHub");

  const openai = detectProviderKey("openai", "sk-0123456789abcdefNOTREAL0123456789");
  assert.ok(openai);
  assert.equal(openai?.provider, "OpenAI");

  const stripe = detectProviderKey("stripe", "sk_test_0123456789abcdefNOTREAL");
  assert.ok(stripe);
  assert.equal(stripe?.provider, "Stripe");
});

test("detectProviderKey never accepts another provider's key shape", () => {
  // A GitHub-shaped token pasted while OpenAI is selected is not a guess —
  // it is refused outright.
  assert.equal(detectProviderKey("openai", "ghp_0123456789abcdefNOTREAL"), null);
  assert.equal(detectProviderKey("github", "sk-0123456789abcdefNOTREAL0123456789"), null);
  assert.equal(detectProviderKey("stripe", "ghp_0123456789abcdefNOTREAL"), null);
});

test("detectProviderKey refuses ordinary non-key clipboard content", () => {
  assert.equal(detectProviderKey("github", "lunch at noon?"), null);
  assert.equal(detectProviderKey("github", "correct horse battery staple"), null);
  assert.equal(detectProviderKey("github", ""), null);
  assert.equal(detectProviderKey("github", "   "), null);
});

test("keyCreateProviderName resolves every covered provider", () => {
  assert.equal(keyCreateProviderName("github"), "GitHub");
  assert.equal(keyCreateProviderName("openai"), "OpenAI");
  assert.equal(keyCreateProviderName("stripe"), "Stripe");
});
