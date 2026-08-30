import assert from "node:assert/strict";
import { test } from "node:test";

import "./test-storage-shim.ts";
import { readActiveVaultId, writeActiveVaultId } from "./active-vault.ts";
import { clearTestStorage } from "./test-storage-shim.ts";

test("remembers the open vault across a cold start", () => {
  clearTestStorage();
  assert.equal(readActiveVaultId(), null);
  writeActiveVaultId("vault_icloud");
  assert.equal(readActiveVaultId(), "vault_icloud");
  writeActiveVaultId(null);
  assert.equal(readActiveVaultId(), null);
});
