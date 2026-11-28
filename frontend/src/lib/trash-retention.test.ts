import assert from "node:assert/strict";
import { test } from "node:test";

import "./test-storage-shim.ts";
import { getTrashRetentionDays, setTrashRetentionDays, trashRetentionStorageKey } from "./trash-retention.ts";

test("defaults to disabled (null) for a vault that never set a retention", () => {
  assert.equal(getTrashRetentionDays("vault_unseen"), null);
});

test("setTrashRetentionDays persists a positive integer and getTrashRetentionDays reads it back", () => {
  const vaultId = "vault_retention_a";
  setTrashRetentionDays(vaultId, 30);
  assert.equal(getTrashRetentionDays(vaultId), 30);
});

test("a fractional value is floored", () => {
  const vaultId = "vault_retention_b";
  setTrashRetentionDays(vaultId, 14.9);
  assert.equal(getTrashRetentionDays(vaultId), 14);
});

test("zero, negative or null clears the setting back to disabled", () => {
  const vaultId = "vault_retention_c";
  setTrashRetentionDays(vaultId, 10);
  assert.equal(getTrashRetentionDays(vaultId), 10);
  setTrashRetentionDays(vaultId, 0);
  assert.equal(getTrashRetentionDays(vaultId), null);
  setTrashRetentionDays(vaultId, 10);
  setTrashRetentionDays(vaultId, -3);
  assert.equal(getTrashRetentionDays(vaultId), null);
  setTrashRetentionDays(vaultId, 10);
  setTrashRetentionDays(vaultId, null);
  assert.equal(getTrashRetentionDays(vaultId), null);
});

test("storage key is namespaced per vault", () => {
  assert.notEqual(trashRetentionStorageKey("vault_a"), trashRetentionStorageKey("vault_b"));
});
