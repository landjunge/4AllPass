import assert from "node:assert/strict";
import { test } from "node:test";

import "./test-storage-shim.ts";
import { isOnboardingDone, markOnboardingDone, onboardingStorageKey } from "./onboarding.ts";

test("onboarding is per vault and starts incomplete", () => {
  assert.equal(isOnboardingDone("vault_a"), false);
  markOnboardingDone("vault_a");
  assert.equal(isOnboardingDone("vault_a"), true);
  assert.equal(isOnboardingDone("vault_b"), false);
  assert.equal(onboardingStorageKey("vault_a").includes("vault_a"), true);
});
