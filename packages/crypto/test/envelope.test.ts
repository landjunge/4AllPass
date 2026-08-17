import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  bytesToHex,
  deriveMasterKey,
  encryptEntry,
  decryptEntry,
  generateSalt,
  generateVaultKey,
  hexToBytes,
  kdfParamsFrom,
  unwrapVaultKey,
  wrapVaultKey,
  ProtocolError,
} from "../src/index.ts";
import { wrapVaultKeyWithNonce, encryptEntryWithNonce } from "../src/test-only.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: {
    vault_id: string;
    entry_id: string;
    device_id: string;
    vault_key: string;
    master_key: string;
    device_key: string;
    recovery_key: string;
  };
  success: Array<{
    id: string;
    nonce: string;
    ciphertext: string;
    tag: string;
    notes?: { envelope_type?: string; plaintext_utf8?: string };
  }>;
}

const suite = loadJson<Suite>("aes-gcm-v1.json");
const C = suite.constants;
const vk = hexToBytes(C.vault_key);

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
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(unwrapVaultKey(env, hexToBytes(C.master_key), C.vault_id), vk);
  });

  it("reproduces TV-ENV-DEVICE", () => {
    const v = vec("TV-ENV-DEVICE");
    const env = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.device_key),
      vaultId: C.vault_id,
      type: "device",
      deviceId: C.device_id,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.ciphertext), v.ciphertext);
    assert.equal(unwrapVaultKey(env, hexToBytes(C.device_key), C.vault_id).length, 32);
  });

  it("reproduces TV-ENV-RECOVERY", () => {
    const v = vec("TV-ENV-RECOVERY");
    const env = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.recovery_key),
      vaultId: C.vault_id,
      type: "recovery",
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(unwrapVaultKey(env, hexToBytes(C.recovery_key), C.vault_id), vk);
  });

  it("rejects ci profile without allowTestProfile", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: generateVaultKey(),
          wrappingKey: hexToBytes(C.master_key),
          vaultId: C.vault_id,
          type: "master",
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
        }),
      ProtocolError,
    );
  });

  it("round-trips a live master envelope (ci, test flag)", () => {
    const wrappingKey = deriveMasterKey("correct-horse-battery-staple", generateSalt(), ARGON2ID_PROFILES.ci);
    const vaultKey = generateVaultKey();
    const env = wrapVaultKey({
      vaultKey,
      wrappingKey,
      vaultId: C.vault_id,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    assert.deepEqual(unwrapVaultKey(env, wrappingKey, C.vault_id), vaultKey);
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
      plaintext,
      nonce: hexToBytes(v.nonce),
    });
    assert.equal(bytesToHex(entry.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(entry.tag), v.tag);
    assert.equal(entry.schemaVersion, 1);
    assert.equal(entry.cryptoVersion, 1);
    assert.deepEqual(decryptEntry(entry, vk, C.vault_id), plaintext);
  });

  it("stores schemaVersion on the entry and uses it on decrypt", () => {
    const plaintext = new TextEncoder().encode('{"title":"x"}');
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      plaintext,
      schemaVersion: 2,
    });
    assert.equal(entry.schemaVersion, 2);
    assert.equal(entry.cryptoVersion, 1);
    assert.deepEqual(decryptEntry(entry, vk, C.vault_id), plaintext);
    const forged = { ...entry, schemaVersion: 1 };
    assert.throws(() => decryptEntry(forged, vk, C.vault_id));
  });

  it("round-trips with a library-owned nonce", () => {
    const plaintext = new TextEncoder().encode('{"title":"x"}');
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      plaintext,
    });
    assert.equal(entry.nonce.length, 12);
    assert.deepEqual(decryptEntry(entry, vk, C.vault_id), plaintext);
  });
});
