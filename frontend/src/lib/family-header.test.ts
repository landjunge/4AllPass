import assert from "node:assert/strict";
import { test } from "node:test";

import { mapLockState } from "./family-header.ts";

test("mapLockState maps vault lock states to appbar self states", () => {
  assert.equal(mapLockState("UNLOCKED"), "unlocked");
  assert.equal(mapLockState("LOCKED"), "locked");
  assert.equal(mapLockState("UNLOCKING"), "vaultUnknown");
  assert.equal(mapLockState("LOCKING"), "vaultUnknown");
});
