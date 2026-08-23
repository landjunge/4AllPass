import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTOFILL_DEMO_PASSWORD,
  AUTOFILL_DEMO_URL,
  AUTOFILL_DEMO_USERNAME,
  autofillDemoDraft,
  isAutofillDemoEntry,
} from "./autofill-demo.ts";

test("demo login stays on the local sidecar origin", () => {
  assert.equal(AUTOFILL_DEMO_URL, "http://127.0.0.1:8788/test-login.html");
  assert.equal(new URL(AUTOFILL_DEMO_URL).hostname, "127.0.0.1");
  const draft = autofillDemoDraft();
  assert.equal(draft.url, AUTOFILL_DEMO_URL);
  assert.equal(draft.username, AUTOFILL_DEMO_USERNAME);
  assert.equal(isAutofillDemoEntry({ url: draft.url }), true);
  assert.equal(isAutofillDemoEntry({ url: "https://github.com/login" }), false);
  assert.equal(AUTOFILL_DEMO_PASSWORD.includes("ghp_"), false);
});
