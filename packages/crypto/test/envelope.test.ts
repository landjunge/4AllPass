import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  bytesToHex,
  decryptEntry,
  deriveMasterKey,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  hexToBytes,
  kdfParamsFrom,
  unwrapVaultKey,
  wrapVaultKey,
  ProtocolError,
} from "../src/index.ts";
import { wrapVaultKeyWithNonce, encryptEntryWithNonce } from "../src/test-only.ts";
import { loadJson, type AesSuite } from "./helpers.ts";

const suite = loadJson<AesSuite>("aes-gcm-v1.json");
const C = suite.constants;
const vk = hexToBytes(C.vault_key);
const VKV = C.vault_key_version;
const DKV = C.device_key_version;
const kdf = kdfParamsFrom(ARGON2ID_PROFILES.ci, hexToBytes(C.kdf.salt));

function vec(id: string) {
  const v = suite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

describe("wrapVaultKey / unwrapVaultKey", () => {
  it("reproduces TV-ENV-MASTER with fixed nonce", () => {
    const v = vec("TV-ENV-MASTER");
    const env = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.master_key),
      vaultId: C.vault_id,
      type: "master",
      vaultKeyVersion: VKV,
      kdf,
      allowTestProfile: true,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(
      unwrapVaultKey(env, {
        wrappingKey: hexToBytes(C.master_key),
        vaultId: C.vault_id,
        expectType: "master",
        expectVaultKeyVersion: VKV,
        allowTestProfile: true,
      }),
      vk,
    );
  });

  it("reproduces TV-ENV-DEVICE", () => {
    const v = vec("TV-ENV-DEVICE");
    const env = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.device_key),
      vaultId: C.vault_id,
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: C.device_id,
      deviceKeyVersion: DKV,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(
      unwrapVaultKey(env, {
        wrappingKey: hexToBytes(C.device_key),
        vaultId: C.vault_id,
        expectType: "device",
        expectVaultKeyVersion: VKV,
        expectDeviceId: C.device_id,
        expectDeviceKeyVersion: DKV,
      }),
      vk,
    );
  });

  it("reproduces TV-ENV-RECOVERY", () => {
    const v = vec("TV-ENV-RECOVERY");
    const env = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.recovery_key),
      vaultId: C.vault_id,
      type: "recovery",
      vaultKeyVersion: VKV,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(
      unwrapVaultKey(env, {
        wrappingKey: hexToBytes(C.recovery_key),
        vaultId: C.vault_id,
        expectType: "recovery",
        expectVaultKeyVersion: VKV,
      }),
      vk,
    );
  });

  it("rejects ci profile without allowTestProfile", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: generateVaultKey(),
          wrappingKey: hexToBytes(C.master_key),
          vaultId: C.vault_id,
          type: "master",
          vaultKeyVersion: VKV,
          kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
        }),
      ProtocolError,
    );
  });

  it("rejects device envelope without deviceId", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: vk,
          wrappingKey: hexToBytes(C.device_key),
          vaultId: C.vault_id,
          type: "device",
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
        }),
      ProtocolError,
    );
  });

  it("rejects device envelope without deviceKeyVersion", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: vk,
          wrappingKey: hexToBytes(C.device_key),
          vaultId: C.vault_id,
          type: "device",
          vaultKeyVersion: VKV,
          deviceId: C.device_id,
        }),
      ProtocolError,
    );
  });

  it("rejects deviceId on a master envelope", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: vk,
          wrappingKey: hexToBytes(C.master_key),
          vaultId: C.vault_id,
          type: "master",
          vaultKeyVersion: VKV,
          kdf,
          allowTestProfile: true,
          deviceId: C.device_id,
        }),
      ProtocolError,
    );
  });

  it("round-trips a live master envelope (ci, test flag)", () => {
    const wrappingKey = deriveMasterKey(
      "correct-horse-battery-staple",
      generateSalt(),
      ARGON2ID_PROFILES.ci,
      { allowTestProfile: true },
    );
    const vaultKey = generateVaultKey();
    const env = wrapVaultKey({
      vaultKey,
      wrappingKey,
      vaultId: C.vault_id,
      type: "master",
      vaultKeyVersion: 7,
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    assert.equal(env.vaultKeyVersion, 7);
    assert.deepEqual(
      unwrapVaultKey(env, {
        wrappingKey,
        vaultId: C.vault_id,
        expectType: "master",
        expectVaultKeyVersion: 7,
        allowTestProfile: true,
      }),
      vaultKey,
    );
  });
});

describe("encryptEntry / decryptEntry", () => {
  it("reproduces TV-ENTRY-01", () => {
    const v = vec("TV-ENTRY-01");
    const plaintext = new TextEncoder().encode(v.notes?.plaintext_utf8 ?? "");
    const entry = encryptEntryWithNonce({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      vaultKeyVersion: VKV,
      plaintext,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(entry.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(entry.tag), v.tag);
    assert.equal(entry.schemaVersion, 1);
    assert.equal(entry.cryptoVersion, 1);
    assert.equal(entry.vaultKeyVersion, VKV);
    assert.deepEqual(
      decryptEntry(entry, {
        vaultKey: vk,
        vaultId: C.vault_id,
        entryId: C.entry_id,
        vaultKeyVersion: VKV,
      }),
      plaintext,
    );
  });

  it("stores schemaVersion on the entry and uses it on decrypt", () => {
    const plaintext = new TextEncoder().encode('{"title":"x"}');
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      vaultKeyVersion: VKV,
      plaintext,
      schemaVersion: 2,
    });
    const opts = {
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      vaultKeyVersion: VKV,
    };
    assert.equal(entry.schemaVersion, 2);
    assert.equal(entry.cryptoVersion, 1);
    assert.deepEqual(decryptEntry(entry, opts), plaintext);
    assert.throws(() => decryptEntry({ ...entry, schemaVersion: 1 }, opts));
  });

  it("round-trips with a library-owned nonce", () => {
    const plaintext = new TextEncoder().encode('{"title":"x"}');
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      vaultKeyVersion: VKV,
      plaintext,
    });
    assert.equal(entry.nonce.length, 12);
    assert.deepEqual(
      decryptEntry(entry, {
        vaultKey: vk,
        vaultId: C.vault_id,
        entryId: C.entry_id,
        vaultKeyVersion: VKV,
      }),
      plaintext,
    );
  });
});
