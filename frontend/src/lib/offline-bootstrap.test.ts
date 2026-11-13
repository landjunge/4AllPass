import "./test-storage-shim.ts";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearOfflineBootstrap,
  fingerprintSessionToken,
  loadOfflineBootstrap,
  saveOfflineBootstrap,
  type OfflineBootstrapBinding,
} from "./offline-bootstrap.ts";

const KEY = "4allpass.offline-bootstrap";

const vault = {
  vaultId: "vault-offline-1",
  cryptoProtocolVersion: 1,
  activeRevision: 3,
  activeVaultKeyVersion: 1,
  createdAt: "2026-11-13T00:00:00Z",
} as const;

let binding: OfflineBootstrapBinding;
let otherBinding: OfflineBootstrapBinding;

beforeEach(async () => {
  clearOfflineBootstrap();
  binding = { sessionFingerprint: await fingerprintSessionToken("token-a"), storageOrigin: null };
  otherBinding = { sessionFingerprint: await fingerprintSessionToken("token-b"), storageOrigin: null };
});

test("fingerprint is deterministic 64-hex and differs per token", async () => {
  const again = await fingerprintSessionToken("token-a");
  assert.equal(again, binding.sessionFingerprint);
  assert.match(again, /^[0-9a-f]{64}$/);
  assert.notEqual(again, otherBinding.sessionFingerprint);
  assert.ok(!again.includes("token-a"));
});

test("round-trips the exact allowlisted projection, bound to the session", async () => {
  await saveOfflineBootstrap("user@example.test", [vault], binding);
  assert.deepEqual(loadOfflineBootstrap(binding), {
    version: 2,
    email: "user@example.test",
    sessionFingerprint: binding.sessionFingerprint,
    storageOrigin: null,
    vaults: [vault],
  });
  const raw = JSON.parse(localStorage.getItem(KEY)!);
  assert.deepEqual(Object.keys(raw).sort(), ["email", "sessionFingerprint", "storageOrigin", "vaults", "version"]);
  assert.deepEqual(Object.keys(raw.vaults[0]).sort(), [
    "activeRevision", "activeVaultKeyVersion", "createdAt", "cryptoProtocolVersion", "vaultId",
  ]);
  assert.ok(!localStorage.getItem(KEY)!.includes("token-a"));
});

test("a different token or origin never loads the cache, and clears it", async () => {
  await saveOfflineBootstrap("user@example.test", [vault], binding);
  assert.equal(loadOfflineBootstrap(otherBinding), null);
  assert.equal(localStorage.getItem(KEY), null);

  await saveOfflineBootstrap("user@example.test", [vault], binding);
  assert.equal(loadOfflineBootstrap({ ...binding, storageOrigin: "https://other.example" }), null);
  assert.equal(localStorage.getItem(KEY), null);

  await saveOfflineBootstrap("user@example.test", [vault], { ...binding, storageOrigin: "https://own.example" });
  assert.equal(loadOfflineBootstrap(binding), null);
});

test("rejects malformed, legacy-version and secret-shaped metadata", async () => {
  localStorage.setItem(KEY, "{not json");
  assert.equal(loadOfflineBootstrap(binding), null);
  // v1 cache from the previous draft: refused and removed.
  localStorage.setItem(KEY, JSON.stringify({ version: 1, email: "x@example.test", vaults: [vault] }));
  assert.equal(loadOfflineBootstrap(binding), null);
  assert.equal(localStorage.getItem(KEY), null);
  localStorage.setItem(KEY, JSON.stringify({ version: 3, email: "x", vaults: [] }));
  assert.equal(loadOfflineBootstrap(binding), null);
  localStorage.setItem(KEY, JSON.stringify({ version: 2, email: "", vaults: [] }));
  assert.equal(loadOfflineBootstrap(binding), null);
});

test("rejects extra top-level fields and extra summary fields (no smuggled secrets)", async () => {
  const record = { version: 2, email: "x@example.test", sessionFingerprint: binding.sessionFingerprint, storageOrigin: null, vaults: [vault] };
  localStorage.setItem(KEY, JSON.stringify({ ...record, token: "raw-token" }));
  assert.equal(loadOfflineBootstrap(binding), null);
  localStorage.setItem(KEY, JSON.stringify({ ...record, vaults: [{ ...vault, vaultKey: "AA==" }] }));
  assert.equal(loadOfflineBootstrap(binding), null);
  assert.equal(localStorage.getItem(KEY), null);
});

test("save projects extra wire fields away (creationGrant, smuggled keys) and never persists them", async () => {
  await saveOfflineBootstrap(
    "user@example.test",
    [{ ...vault, creationGrant: null, vaultKey: "AA==" } as never],
    binding,
  );
  const loaded = loadOfflineBootstrap(binding);
  assert.deepEqual(loaded?.vaults, [vault]);
  assert.ok(!localStorage.getItem(KEY)!.includes("vaultKey"));
  assert.ok(!localStorage.getItem(KEY)!.includes("creationGrant"));
});

test("save refuses invalid input without throwing, clearing stale data", async () => {
  await saveOfflineBootstrap("user@example.test", [vault], binding);
  await saveOfflineBootstrap("user@example.test", [{ ...vault, activeRevision: 1.5 } as never], binding);
  assert.equal(localStorage.getItem(KEY), null);
  await saveOfflineBootstrap("", [vault], binding);
  await saveOfflineBootstrap("user@example.test", [vault], { sessionFingerprint: "raw-token", storageOrigin: null });
  assert.equal(localStorage.getItem(KEY), null);
});

test("rejects unsafe integers and protocol downgrade attempts", async () => {
  // NaN/Infinity serialize to JSON null (a valid fresh-vault value), so only
  // values that survive JSON as numbers/strings are exercised here.
  for (const activeRevision of [1.5, 0, -1, 2 ** 53, "3"]) {
    localStorage.setItem(KEY, JSON.stringify({
      version: 2, email: "x@example.test", sessionFingerprint: binding.sessionFingerprint,
      storageOrigin: null, vaults: [{ ...vault, activeRevision }],
    }));
    assert.equal(loadOfflineBootstrap(binding), null, `activeRevision ${String(activeRevision)}`);
  }
  localStorage.setItem(KEY, JSON.stringify({
    version: 2, email: "x@example.test", sessionFingerprint: binding.sessionFingerprint,
    storageOrigin: null, vaults: [{ ...vault, cryptoProtocolVersion: 2 }],
  }));
  assert.equal(loadOfflineBootstrap(binding), null);
  // null revision/key version stays valid (fresh vault).
  await saveOfflineBootstrap("user@example.test", [{ ...vault, activeRevision: null, activeVaultKeyVersion: null }], binding);
  assert.equal(loadOfflineBootstrap(binding)?.vaults[0].activeRevision, null);
});

test("invalid binding fails closed", async () => {
  await saveOfflineBootstrap("user@example.test", [vault], binding);
  assert.equal(loadOfflineBootstrap({ sessionFingerprint: "zz", storageOrigin: null }), null);
  assert.equal(loadOfflineBootstrap(null as never), null);
});

test("clear removes the metadata", async () => {
  await saveOfflineBootstrap("user@example.test", [vault], binding);
  clearOfflineBootstrap();
  assert.equal(loadOfflineBootstrap(binding), null);
});
