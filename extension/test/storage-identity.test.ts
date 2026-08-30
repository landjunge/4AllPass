import assert from "node:assert/strict";
import { test } from "node:test";

import { assertAccountIfNeeded, mustUseAccountLogin, pickVaultId } from "../src/storage-identity.ts";

test("other accounts on this Mac require e-mail login, not /auth/local", () => {
  assert.equal(mustUseAccountLogin({ hasOtherAccounts: true }), true);
  assert.equal(mustUseAccountLogin({ hasOtherAccounts: false }), false);
  assert.equal(mustUseAccountLogin(null), false);
  assert.equal(mustUseAccountLogin({}), false);
  assert.throws(
    () => assertAccountIfNeeded({ hasOtherAccounts: true }, "", ""),
    /This device has an account/,
  );
  assert.doesNotThrow(() =>
    assertAccountIfNeeded({ hasOtherAccounts: true }, "ada@example.com", "account-password-1234"),
  );
  assert.doesNotThrow(() => assertAccountIfNeeded({ hasOtherAccounts: false }, "", ""));
});

test("prefers the remembered vault when it is still in the list", () => {
  const vaults = [{ vaultId: "older" }, { vaultId: "icloud" }];
  assert.equal(pickVaultId(vaults, "icloud"), "icloud");
  assert.equal(pickVaultId(vaults, "gone"), "older");
  assert.equal(pickVaultId([], "icloud"), null);
});
