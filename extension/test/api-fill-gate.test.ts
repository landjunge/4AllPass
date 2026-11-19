import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSetup } from "@4allpass/providers";
import {
  API_FILL_MIN_CONFIDENCE,
  apiFillAllowed,
  createSuggestionBinding,
  parseSuggestionBinding,
  suggestionAcceptanceFailure,
  suggestionBindingStillHolds,
  type SuggestionBinding,
} from "../src/api-fill-gate.ts";

const attackerUrl = "https://evil.example/settings";
const genuineUrl = "https://api.openai.com/v1/api-keys";

function genuine() {
  return detectSetup({ url: genuineUrl, fieldNames: ["openai_api_key"] });
}

test("a lone openai_api_key field on a foreign origin never passes the API fill gate", () => {
  const suggestion = detectSetup({ url: attackerUrl, fieldNames: ["openai_api_key"] });
  assert.equal(suggestion.providerId, "openai");
  assert.equal(suggestion.credentialKind, "api");
  assert.equal(suggestion.domainHit, false);
  assert.ok(suggestion.confidence < API_FILL_MIN_CONFIDENCE);
  assert.equal(apiFillAllowed(suggestion), false);
});

test("openai_api_key on github.com is a conflict and never passes the API fill gate", () => {
  const suggestion = detectSetup({
    url: "https://github.com/settings",
    fieldNames: ["openai_api_key"],
  });
  assert.equal(suggestion.domainHit, false);
  assert.ok(suggestion.confidence < API_FILL_MIN_CONFIDENCE);
  assert.equal(apiFillAllowed(suggestion), false);
});

test("a genuine provider-domain match with high confidence still fills", () => {
  const suggestion = genuine();
  assert.equal(suggestion.providerId, "openai");
  assert.equal(suggestion.credentialKind, "api");
  assert.equal(suggestion.domainHit, true);
  assert.ok(suggestion.confidence >= API_FILL_MIN_CONFIDENCE);
  assert.equal(apiFillAllowed(suggestion), true);
});

test("accepting a binding on another tab does not fill", () => {
  const suggestion = genuine();
  const binding = createSuggestionBinding({ id: 7, url: genuineUrl }, suggestion);
  assert.ok(binding);
  assert.equal(suggestionBindingStillHolds(binding, { id: 8, url: genuineUrl }, { id: 8 }), false);
});

test("accepting after a navigation on the same tab does not fill", () => {
  const suggestion = genuine();
  const binding = createSuggestionBinding({ id: 7, url: genuineUrl }, suggestion);
  assert.ok(binding);
  assert.equal(
    suggestionBindingStillHolds(binding, { id: 7, url: "https://api.openai.com/v1/other" }, { id: 7 }),
    false,
  );
  assert.equal(
    suggestionBindingStillHolds(binding, { id: 7, url: "https://evil.example/v1/api-keys" }, { id: 7 }),
    false,
  );
  assert.equal(
    suggestionBindingStillHolds(
      binding,
      { id: 7, url: "https://api.openai.com.evil.example/v1/api-keys" },
      { id: 7 },
    ),
    false,
  );
});

test("accepting after switching the active tab does not fill", () => {
  const suggestion = genuine();
  const binding = createSuggestionBinding({ id: 7, url: genuineUrl }, suggestion);
  assert.ok(binding);
  assert.equal(suggestionBindingStillHolds(binding, { id: 7, url: genuineUrl }, { id: 8 }), false);
  assert.equal(suggestionBindingStillHolds(binding, { id: 7, url: genuineUrl }, { id: 7 }), true);
});

test("a fresh detection for the bound page passes the acceptance gate", () => {
  const suggestion = genuine();
  const binding = createSuggestionBinding({ id: 7, url: genuineUrl }, suggestion);
  assert.ok(binding);
  assert.equal(suggestionAcceptanceFailure(binding, genuine()), null);
});

test("a field-only or conflicting page fails the acceptance gate even with a binding", () => {
  const suggestion = genuine();
  const binding = createSuggestionBinding({ id: 7, url: attackerUrl }, suggestion);
  assert.ok(binding);
  assert.equal(
    suggestionAcceptanceFailure(
      binding,
      detectSetup({ url: attackerUrl, fieldNames: ["openai_api_key"] }),
    ),
    "low-confidence",
  );
  assert.equal(
    suggestionAcceptanceFailure(
      binding,
      detectSetup({ url: attackerUrl, fieldNames: ["github_pat"] }),
    ),
    "no-match",
  );
});

test("acceptance without a binding is rejected", () => {
  assert.equal(suggestionAcceptanceFailure(null, genuine()), "no-match");
  assert.equal(suggestionAcceptanceFailure(undefined, genuine()), "no-match");
});

test("malformed bindings are rejected, not repaired", () => {
  assert.equal(parseSuggestionBinding(undefined), null);
  assert.equal(parseSuggestionBinding({}), null);
  assert.equal(parseSuggestionBinding({ tabId: "7", url: genuineUrl, host: "api.openai.com" }), null);
  assert.equal(
    parseSuggestionBinding({
      tabId: 7,
      url: genuineUrl,
      host: "evil.example",
      providerId: "openai",
      credentialKind: "api",
      matchedField: "openai_api_key",
    }),
    null,
  );
  const valid: SuggestionBinding = {
    tabId: 7,
    url: genuineUrl,
    host: "api.openai.com",
    providerId: "openai",
    credentialKind: "api",
    matchedField: "openai_api_key",
  };
  assert.deepEqual(parseSuggestionBinding(valid), valid);
});
