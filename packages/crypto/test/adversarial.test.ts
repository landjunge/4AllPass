import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  RollbackError,
  acceptSnapshot,
  assertDeviceKeyVersion,
  decryptEntry,
  deriveDeviceWrappingKey,
  encryptEntry,
  evaluateRevision,
  generateDeviceKey,
  generateVaultKey,
  hexToBytes,
  prfEvalFirst,
  sealManifest,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapVaultKey,
  zeroize,
} from "../src/index.ts";
import { encryptEntryWithNonce, wrapDeviceKeyWithNonce } from "../src/test-only.ts";
import * as publicApi from "../src/index.ts";

const vaultId = "vault_01HZX4ALLPASS000000000001";
const otherVault = "vault_OTHER";
const entryId = "entry_01HZX4ALLPASS0000000000A1";
const deviceId = "dev_macbook_chrome_profile_1";
const credentialId = hexToBytes("cafebabecafebabecafebabecafebabe");
const prfOutput = hexToBytes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

function snapshot(revision: number, vaultKeyVersion = 1) {
  return { vaultId, revision, vaultKeyVersion, cryptoProtocolVersion: 1 as const };
}

describe("adversarial: nonce reuse / ownership", () => {
  it("public encryptEntry does not take a nonce argument", () => {
    assert.equal(encryptEntry.length, 1);
    assert.equal("encryptEntryWithNonce" in publicApi, false);
    assert.equal("wrapVaultKeyWithNonce" in publicApi, false);
    assert.equal("wrapDeviceKeyWithNonce" in publicApi, false);
    assert.equal("sealManifestWithNonce" in publicApi, false);
  });
});

describe("adversarial: version confusion", () => {
  it("refuses to write an unsupported entry cryptoVersion", () => {
    assert.throws(
      () =>
        encryptEntry({
          vaultKey: generateVaultKey(),
          vaultId,
          entryId,
          plaintext: new Uint8Array([1]),
          cryptoVersion: 2,
        }),
      ProtocolError,
    );
  });

  it("refuses to write a device-key envelope whose AAD version would not match the stored version", () => {
    assert.throws(
      () =>
        wrapDeviceKey({
          deviceKey: generateDeviceKey(),
          deviceWrappingKey: generateVaultKey(),
          vaultId,
          deviceId,
          credentialId,
          cryptoVersion: 2,
        }),
      ProtocolError,
    );
  });

  it("forged schemaVersion on an existing entry fails AAD", () => {
    const vaultKey = generateVaultKey();
    const entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId,
      plaintext: new Uint8Array([1]),
      schemaVersion: 2,
    });
    assert.throws(() => decryptEntry({ ...entry, schemaVersion: 1 }, vaultKey, vaultId), AuthFailureError);
  });
});

describe("adversarial: AAD mismatch / cross-vault / cross-device", () => {
  it("rejects decrypting an entry under another vaultId", () => {
    const vaultKey = generateVaultKey();
    const entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId,
      plaintext: new Uint8Array([1]),
    });
    assert.throws(() => decryptEntry(entry, vaultKey, otherVault), AuthFailureError);
  });

  it("rejects unwrapping a device envelope with the wrong deviceId label", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId,
      type: "device",
      deviceId,
    });
    const swapped = { ...env, deviceId: "dev_other" };
    assert.throws(() => unwrapVaultKey(swapped, deviceKey, vaultId), AuthFailureError);
  });

  it("rejects unwrapping a master envelope as a recovery envelope", () => {
    const vaultKey = generateVaultKey();
    const wrappingKey = generateVaultKey();
    const env = wrapVaultKey({
      vaultKey,
      wrappingKey,
      vaultId,
      type: "master",
      kdf: {
        algorithm: "argon2id",
        version: 0x13,
        memory: 32_768,
        iterations: 3,
        parallelism: 4,
        hashLen: 32,
        salt: new Uint8Array(16).fill(7),
      },
    });
    const swapped = { ...env, type: "recovery" as const };
    delete (swapped as { kdf?: unknown }).kdf;
    assert.throws(() => unwrapVaultKey(swapped, wrappingKey, vaultId), AuthFailureError);
  });
});

describe("adversarial: key substitution / credential swapping / PRF misuse", () => {
  it("rejects a truncated or oversized PRF output", () => {
    const base = {
      rpId: "pass.example.local",
      vaultId,
      deviceId,
      credentialId,
    };
    assert.throws(() => deriveDeviceWrappingKey({ ...base, prfOutput: prfOutput.subarray(0, 16) }), ProtocolError);
    assert.throws(
      () => deriveDeviceWrappingKey({ ...base, prfOutput: new Uint8Array(33).fill(1) }),
      ProtocolError,
    );
  });

  it("PRF eval.first is bound to rpId and vaultId", () => {
    const a = prfEvalFirst("pass.example.local", vaultId);
    const b = prfEvalFirst("other.example.local", vaultId);
    const c = prfEvalFirst("pass.example.local", otherVault);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.equal(a.length, 32);
  });

  it("rejects swapping credentialId on a Device-Key Envelope", () => {
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId: "pass.example.local",
      vaultId,
      deviceId,
      credentialId,
    });
    const env = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwk,
      vaultId,
      deviceId,
      credentialId,
    });
    const swapped = { ...env, credentialId: new Uint8Array(16).fill(0x11) };
    assert.throws(() => unwrapDeviceKey(swapped, dwk), AuthFailureError);
  });

  it("rejects a Device-Key Envelope from another vault", () => {
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId: "pass.example.local",
      vaultId,
      deviceId,
      credentialId,
    });
    const env = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwk,
      vaultId,
      deviceId,
      credentialId,
    });
    const swapped = { ...env, vaultId: otherVault };
    assert.throws(() => unwrapDeviceKey(swapped, dwk), AuthFailureError);
  });
});

describe("adversarial: rollback / downgrade / deviceKeyVersion", () => {
  it("evaluateRevision still refuses rollback and vault-key downgrade", () => {
    const last = snapshot(10, 2);
    const rollback = evaluateRevision(last, snapshot(7, 2));
    assert.equal(rollback.ok, false);
    if (!rollback.ok) assert.ok(rollback.error instanceof RollbackError);
    const down = evaluateRevision(last, snapshot(11, 1));
    assert.equal(down.ok, false);
    if (!down.ok) assert.equal(down.action, "downgrade");
  });

  it("acceptSnapshot refuses a replayed older authentic snapshot", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId,
      type: "recovery",
    });
    const oldSealed = sealManifest({
      vaultKey,
      vaultId,
      revision: 4,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [],
    });
    assert.throws(
      () =>
        acceptSnapshot({
          lastSeen: snapshot(9, 1),
          vaultKey,
          claimed: snapshot(4, 1),
          manifest: oldSealed,
          envelopes: [envelope],
          entries: [],
        }),
      RollbackError,
    );
  });

  it("deviceKeyVersion downgrade is refused; AAD binds the version", () => {
    assert.equal(assertDeviceKeyVersion(null, 1), "first_seen");
    assert.equal(assertDeviceKeyVersion(2, 2), "same");
    assert.equal(assertDeviceKeyVersion(2, 3), "advance");
    assert.throws(() => assertDeviceKeyVersion(3, 2), IntegrityError);

    const dwk = generateVaultKey();
    const dk = generateDeviceKey();
    const v1 = wrapDeviceKey({
      deviceKey: dk,
      deviceWrappingKey: dwk,
      vaultId,
      deviceId,
      credentialId,
      deviceKeyVersion: 1,
    });
    const forged = { ...v1, deviceKeyVersion: 2 };
    assert.throws(() => unwrapDeviceKey(forged, dwk), AuthFailureError);
  });
});

describe("adversarial: malformed input / truncation / empty ids", () => {
  it("rejects empty vaultId and entryId", () => {
    const vaultKey = generateVaultKey();
    assert.throws(
      () => encryptEntry({ vaultKey, vaultId: "", entryId, plaintext: new Uint8Array([1]) }),
      ProtocolError,
    );
    assert.throws(
      () => encryptEntry({ vaultKey, vaultId, entryId: "", plaintext: new Uint8Array([1]) }),
      ProtocolError,
    );
  });

  it("rejects truncated ciphertext / tag on decrypt", () => {
    const vaultKey = generateVaultKey();
    const entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId,
      plaintext: new Uint8Array([1, 2, 3]),
    });
    assert.throws(
      () => decryptEntry({ ...entry, tag: entry.tag.subarray(0, 8) }, vaultKey, vaultId),
      ProtocolError,
    );
    assert.throws(
      () => decryptEntry({ ...entry, ciphertext: entry.ciphertext.subarray(0, 1) }, vaultKey, vaultId),
      AuthFailureError,
    );
  });

  it("rejects wrapping a device envelope without deviceId", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey: generateVaultKey(),
          wrappingKey: generateDeviceKey(),
          vaultId,
          type: "device",
        }),
      ProtocolError,
    );
  });
});

describe("adversarial: HKDF domain separation / zeroization / test-only leakage", () => {
  it("manifest key differs from the vault key and across revisions", () => {
    const vaultKey = generateVaultKey();
    const { deriveManifestKey } = publicApi;
    const a = deriveManifestKey(vaultKey, vaultId, 1, 1);
    const b = deriveManifestKey(vaultKey, vaultId, 2, 1);
    assert.notDeepEqual(a, vaultKey);
    assert.notDeepEqual(a, b);
  });

  it("zeroize overwrites the buffer in place", () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    zeroize(buf);
    assert.deepEqual(buf, new Uint8Array([0, 0, 0, 0]));
  });

  it("fixed-nonce hooks are not on the public surface", () => {
    const keys = Object.keys(publicApi);
    for (const name of keys) {
      assert.equal(name.includes("WithNonce"), false, name);
    }
  });
});

describe("adversarial: snapshot mix-and-match", () => {
  it("cannot pair revision-50 metadata with a revision-4 manifest", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId,
      type: "recovery",
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId,
      revision: 4,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [],
    });
    assert.throws(
      () =>
        acceptSnapshot({
          lastSeen: null,
          vaultKey,
          claimed: snapshot(50, 7),
          manifest: sealed,
          envelopes: [envelope],
          entries: [],
        }),
      IntegrityError,
    );
  });

  it("cannot keep an old entry after sealing a new snapshot", () => {
    const vaultKey = generateVaultKey();
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: generateVaultKey(),
      vaultId,
      type: "recovery",
    });
    const oldEntry = encryptEntryWithNonce({
      vaultKey,
      vaultId,
      entryId,
      plaintext: new Uint8Array([1]),
      nonce: new Uint8Array(12).fill(1),
    });
    const newEntry = encryptEntryWithNonce({
      vaultKey,
      vaultId,
      entryId,
      plaintext: new Uint8Array([2]),
      nonce: new Uint8Array(12).fill(2),
    });
    const sealed = sealManifest({
      vaultKey,
      vaultId,
      revision: 5,
      vaultKeyVersion: 1,
      envelopes: [envelope],
      entries: [newEntry],
    });
    assert.throws(
      () =>
        acceptSnapshot({
          lastSeen: snapshot(4),
          vaultKey,
          claimed: snapshot(5),
          manifest: sealed,
          envelopes: [envelope],
          entries: [oldEntry],
        }),
      IntegrityError,
    );
  });
});

describe("adversarial: wrapDeviceKeyWithNonce version is consistent", () => {
  it("stores version 1 and unwraps when cryptoVersion is omitted", () => {
    const dwk = generateVaultKey();
    const dk = generateDeviceKey();
    const env = wrapDeviceKeyWithNonce({
      deviceKey: dk,
      deviceWrappingKey: dwk,
      vaultId,
      deviceId,
      credentialId,
      nonce: new Uint8Array(12).fill(3),
    });
    assert.equal(env.version, 1);
    assert.equal(env.deviceKeyVersion, 1);
    assert.deepEqual(unwrapDeviceKey(env, dwk), dk);
  });
});
