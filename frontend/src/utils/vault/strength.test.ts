import assert from "node:assert/strict";
import { test } from "node:test";

import { countWeakSecrets, passwordStrength } from "./strength.ts";

test("passwordStrength never treats empty as weak", () => {
  assert.equal(passwordStrength(""), "empty");
});

test("short or single-class secrets are weak", () => {
  assert.equal(passwordStrength("abc"), "weak");
  assert.equal(passwordStrength("aaaaaaaaaa"), "weak");
});

test("mixed longer secrets are ok or strong", () => {
  assert.equal(passwordStrength("Abcdefghij1"), "ok");
  assert.equal(passwordStrength("Abcdefghijklmn1!"), "strong");
});

test("countWeakSecrets ignores empty", () => {
  assert.equal(countWeakSecrets(["", "short", "Abcdefghijklmn1!"]), 1);
});
