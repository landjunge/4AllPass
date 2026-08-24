import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  RollbackError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
} from "@4allpass/crypto";

import { memoryPinStore } from "../src/revision-pin.ts";
import { openUnlockedSnapshot, storageAuthRequest } from "../src/unlock.ts";

const PASSWORD = "extension-unlock-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;

function sealedSnapshot(
  vaultId: string,
  revision: number,
  secrets: Record<string, string> = { entry_demo: '{"title":"Demo","password":"one"}' },
) {
  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(PASSWORD, salt, profile);
  const master = wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
  const entries = Object.entries(secrets).map(([entryId, secret]) =>
    encryptEntry({
      vaultKey,
      vaultId,
      entryId,
      vaultKeyVersion: 1,
      plaintext: new TextEncoder().encode(secret),
    }),
  );
  const sealedManifest = sealManifest({
    vaultKey,
    manifest: buildManifest({
      vaultId,
      revision,
      vaultKeyVersion: 1,
      envelopes: [master],
      entries,
    }),
  });
  return encodeVaultSnapshot({
    vaultId,
    revision,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes: [master],
    entries,
    sealedManifest,
  });
}

test("desktop local unlock uses /auth/local and no account body", () => {
  const auth = storageAuthRequest("", "");
  assert.equal(auth.path, "/auth/local");
  assert.equal(auth.body, undefined);
  assert.equal(storageAuthRequest("  ", "").path, "/auth/local");
});

test("server unlock still posts email to /auth/login", () => {
  const auth = storageAuthRequest("ada@example.com", "account-password-1234");
  assert.equal(auth.path, "/auth/login");
  assert.deepEqual(auth.body, {
    email: "ada@example.com",
    password: "account-password-1234",
  });
});

test("partial account fields do not silently become local auth", () => {
  assert.equal(storageAuthRequest("ada@example.com", "").path, "/auth/login");
  assert.equal(storageAuthRequest("", "account-password-1234").path, "/auth/login");
});

test("openUnlockedSnapshot verifies the sealed manifest and pins revision", () => {
  const vaultId = "vault_ext_pin_01HZX4ALLPASS0000000001";
  const wire = sealedSnapshot(vaultId, 3);
  const opened = openUnlockedSnapshot(wire, { vaultId, vaultPassword: PASSWORD });
  assert.equal(opened.entries.length, 1);
  assert.equal(opened.entries[0]?.password, "one");
  assert.equal(opened.pin.revision, 3);
  assert.equal(opened.pin.vaultId, vaultId);
  assert.ok(opened.pin.manifestDigest);
});

test("openUnlockedSnapshot refuses a replayed older snapshot after the pin", () => {
  const vaultId = "vault_ext_rollback_01HZX4ALLPASS0000001";
  const newer = openUnlockedSnapshot(sealedSnapshot(vaultId, 4), {
    vaultId,
    vaultPassword: PASSWORD,
  });
  assert.throws(
    () =>
      openUnlockedSnapshot(sealedSnapshot(vaultId, 2), {
        vaultId,
        vaultPassword: PASSWORD,
        pin: newer.pin,
      }),
    RollbackError,
  );
});

test("openUnlockedSnapshot refuses an entry dropped from a verified snapshot", () => {
  const vaultId = "vault_ext_trunc_01HZX4ALLPASS000000001";
  const wire = sealedSnapshot(vaultId, 1, {
    entry_keep: '{"title":"Keep","password":"keep"}',
    entry_drop: '{"title":"Drop","password":"drop"}',
  });
  const truncated = { ...wire, entries: wire.entries.slice(0, 1) };
  assert.throws(
    () => openUnlockedSnapshot(truncated, { vaultId, vaultPassword: PASSWORD }),
    IntegrityError,
  );
});

test("memory pin store persists the digest across unlocks", async () => {
  const vaultId = "vault_ext_store_01HZX4ALLPASS000000001";
  const store = memoryPinStore();
  const first = openUnlockedSnapshot(sealedSnapshot(vaultId, 5), {
    vaultId,
    vaultPassword: PASSWORD,
  });
  await store.save(first.pin);
  const loaded = await store.load(vaultId);
  assert.ok(loaded);
  assert.equal(loaded.revision, 5);
  assert.throws(
    () =>
      openUnlockedSnapshot(sealedSnapshot(vaultId, 1), {
        vaultId,
        vaultPassword: PASSWORD,
        pin: loaded,
      }),
    RollbackError,
  );
});
