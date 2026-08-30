import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordsAreSame } from "../src/password-separation.ts";

test("same trimmed strings collide", () => {
  assert.equal(passwordsAreSame("dummy-account", "dummy-account"), true);
});

test("empty or distinct strings do not collide", () => {
  assert.equal(passwordsAreSame("", "dummy-vault"), false);
  assert.equal(passwordsAreSame("dummy-account", "dummy-vault"), false);
});
