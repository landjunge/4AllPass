import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  acceptSnapshot,
  bytesToHex,
  decryptEntry,
  deriveManifestKey,
  encryptEntry,
  generateVaultKey,
  hexToBytes,
  openManifest,
  sealManifest,
  unwrapVaultKey,
  wrapVaultKey,
} from "../src/index.ts";
import { encryptEntryWithNonce, sealManifestWithNonce, wrapVaultKeyWithNonce } from "../src/test-only.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: {
    vault_id: string;
    entry_id: string;
    vault_key: string;
    master_key: string;
    revision: number;
    vault_key_version: number;
  };
  success: Array<Record<string, string | number>>;
}

const suite = loadJson<Suite>("manifest-v1.json");
const C = suite.constants;
const vk = hexToBytes(C.vault_key);

function find(id: string): Record<string, string | number> {
  const v = suite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

function req(v: Record<string, string | number>, key: string): string {
  const value = v[key];
  assert.ok(typeof value === "string", key);
  return value;
}

const claimed = {
  vaultId: C.vault_id,
  revision: C.revision,
  vaultKeyVersion: C.vault_key_version,
  cryptoProtocolVersion: 1 as const,
};

describe("authenticated vault manifest", () => {
  it("TV-MANIFEST-KEY derives the snapshot key", () => {
    const v = find("TV-MANIFEST-KEY");
    const key = deriveManifestKey(vk, C.vault_id, C.revision, C.vault_key_version);
    assert.equal(bytesToHex(key), req(v, "manifest_key"));
  });

  it("TV-MANIFEST-01 seals and opens a snapshot", () => {
    const v = find("TV-MANIFEST-01");
    const envelope = wrapVaultKeyWithNonce({
      vaultKey: vk,
      wrappingKey: hexToBytes(C.master_key),
      vaultId: C.vault_id,
      type: "master",
      kdf: {
        algorithm: "argon2id",
        version: 0x13,
        memory: 32,
        iterations: 3,
        parallelism: 4,
        hashLen: 32,
        salt: hexToBytes("00112233445566778899aabbccddeeff"),
      },
      allowTestProfile: true,
      nonce: hexToBytes("0102030405060708090a0b0c"),
    });
    const entry = encryptEntryWithNonce({
      vaultKey: vk,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      plaintext: new TextEncoder().encode('{"title":"Example"}'),
      nonce: hexToBytes("111111111111111111111111"),
    });
    const sealed = sealManifestWithNonce({
      vaultKey: vk,
      vaultId: C.vault_id,
      revision: C.revision,
      vaultKeyVersion: C.vault_key_version,
      envelopes: [envelope],
      entries: [entry],
      nonce: hexToBytes(req(v, "nonce")),
    });
    assert.equal(bytesToHex(sealed.ciphertext), req(v, "ciphertext"));
    assert.equal(bytesToHex(sealed.tag), req(v, "tag"));
    const opened = openManifest(sealed, vk);
    assert.equal(opened.revision, C.revision);
    assert.equal(opened.entries.length, 1);
    const accepted = acceptSnapshot({
      lastSeen: null,
      vaultKey: vk,
      claimed,
      manifest: sealed,
      envelopes: [envelope],
      entries: [entry],
    });
    assert.equal(accepted.action, "first_seen");
  });

  it("refuses a server-claimed revision that does not match the sealed header", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId: C.vault_id,
      type: "recovery",
    });
    const entry = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      plaintext: new Uint8Array([1]),
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId: C.vault_id,
      revision: 7,
      vaultKeyVersion: 2,
      envelopes: [envelope],
      entries: [entry],
    });
    assert.throws(
      () =>
        acceptSnapshot({
          lastSeen: null,
          vaultKey,
          claimed: { ...claimed, revision: 50, vaultKeyVersion: 2 },
          manifest: sealed,
          envelopes: [envelope],
          entries: [entry],
        }),
      IntegrityError,
    );
  });

  it("refuses mixed entries from another snapshot", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId: C.vault_id,
      type: "recovery",
    });
    const entryA = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_A",
      plaintext: new Uint8Array([1]),
    });
    const entryB = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_B",
      plaintext: new Uint8Array([2]),
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId: C.vault_id,
      revision: 3,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [entryA],
    });
    assert.throws(
      () =>
        acceptSnapshot({
          lastSeen: null,
          vaultKey,
          claimed: { vaultId: C.vault_id, revision: 3, vaultKeyVersion: 1, cryptoProtocolVersion: 1 },
          manifest: sealed,
          envelopes: [envelope],
          entries: [entryB],
        }),
      IntegrityError,
    );
  });

  it("tampering the sealed revision header fails AEAD", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId: C.vault_id,
      type: "recovery",
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId: C.vault_id,
      revision: 4,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [],
    });
    const swapped = { ...sealed, revision: 50 };
    assert.throws(() => openManifest(swapped, vaultKey), AuthFailureError);
  });

  it("round-trips a live snapshot and decrypts the bound entry", () => {
    const vaultKey = generateVaultKey();
    const wrappingKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey,
      vaultId: C.vault_id,
      type: "recovery",
    });
    const plaintext = new TextEncoder().encode('{"title":"live"}');
    const entry = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: C.entry_id,
      plaintext,
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId: C.vault_id,
      revision: 1,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [entry],
    });
    const accepted = acceptSnapshot({
      lastSeen: null,
      vaultKey: unwrapVaultKey(envelope, wrappingKey, C.vault_id),
      claimed: { vaultId: C.vault_id, revision: 1, vaultKeyVersion: 1, cryptoProtocolVersion: 1 },
      manifest: sealed,
      envelopes: [envelope],
      entries: [entry],
    });
    assert.equal(accepted.action, "first_seen");
    assert.deepEqual(decryptEntry(entry, vaultKey, C.vault_id), plaintext);
  });
});
