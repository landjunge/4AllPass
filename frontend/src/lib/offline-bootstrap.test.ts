import "./test-storage-shim.ts";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearOfflineBootstrap, loadOfflineBootstrap, saveOfflineBootstrap,
} from "./offline-bootstrap.ts";

const vault = {
  vaultId: "vault-offline-1",
  cryptoProtocolVersion: 1,
  activeRevision: 3,
  activeVaultKeyVersion: 1,
  createdAt: "2026-11-13T00:00:00Z",
} as const;

beforeEach(() => clearOfflineBootstrap());

test("round-trips metadata only", () => {
  saveOfflineBootstrap("user@example.test", [vault]);
  assert.deepEqual(loadOfflineBootstrap(), {
    version: 1,
    email: "user@example.test",
    vaults: [vault],
  });
});

test("rejects malformed, wrong-version and secret-shaped metadata", () => {
  localStorage.setItem("4allpass.offline-bootstrap", "{not json");
  assert.equal(loadOfflineBootstrap(), null);
  localStorage.setItem("4allpass.offline-bootstrap", JSON.stringify({ version: 2, email: "x", vaults: [] }));
  assert.equal(loadOfflineBootstrap(), null);
  localStorage.setItem("4allpass.offline-bootstrap", JSON.stringify({ version: 1, email: "x", vaults: [{ vaultId: "" }] }));
  assert.equal(loadOfflineBootstrap(), null);
  localStorage.setItem("4allpass.offline-bootstrap", JSON.stringify({ version: 1, email: "x", vaults: [{ ...vault, vaultKey: "AA==" }] }));
  assert.equal(loadOfflineBootstrap(), null);
});

test("clear removes the metadata", () => {
  saveOfflineBootstrap("user@example.test", [vault]);
  clearOfflineBootstrap();
  assert.equal(loadOfflineBootstrap(), null);
});
