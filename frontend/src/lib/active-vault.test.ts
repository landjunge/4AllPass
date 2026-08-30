import assert from "node:assert/strict";
import { test } from "node:test";

import "./test-storage-shim.ts";
import { readActiveVaultId, writeActiveVaultId } from "./active-vault.ts";
import { clearTestStorage } from "./test-storage-shim.ts";

test("remembers the open vault across a cold start", () => {
  clearTestStorage();
  assert.equal(readActiveVaultId(), null);
  writeActiveVaultId("00000000-0000-4000-8000-000000000001");
  assert.equal(readActiveVaultId(), "00000000-0000-4000-8000-000000000001");
  writeActiveVaultId(null);
  assert.equal(readActiveVaultId(), null);
});

test("ignores non-uuid values so junk cannot steal the pin", () => {
  clearTestStorage();
  writeActiveVaultId("vault_icloud");
  assert.equal(readActiveVaultId(), null);
});
