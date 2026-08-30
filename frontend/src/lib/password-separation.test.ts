import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordsAreSame } from "./password-separation.ts";

test("same trimmed strings collide", () => {
  assert.equal(passwordsAreSame("dummy-account", "dummy-account"), true);
  assert.equal(passwordsAreSame("  dummy-account  ", "dummy-account"), true);
});

test("empty sides do not collide", () => {
  assert.equal(passwordsAreSame("", "dummy-vault"), false);
  assert.equal(passwordsAreSame("dummy-account", ""), false);
  assert.equal(passwordsAreSame("   ", "   "), false);
});

test("distinct strings do not collide", () => {
  assert.equal(passwordsAreSame("dummy-account", "dummy-vault"), false);
});
