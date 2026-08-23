import assert from "node:assert/strict";
import { test } from "node:test";
import { profileKey } from "./browsers.ts";

test("profileKey is stable per browser and profile", () => {
  assert.equal(profileKey("chrome", "Default"), "chrome:Default");
  assert.notEqual(profileKey("chrome", "Profile 1"), profileKey("brave", "Profile 1"));
});
