/**
 * Adversarial suite: every test models a concrete attacker capability
 * (malicious server, swapped blobs, tampered metadata, hostile KDF params)
 * and asserts the library refuses it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  ProtocolError,
  bytesToHex,
  decryptEntry,
  deriveDeviceWrappingKey,
  deriveMasterKeyFromEnvelope,
  encodeAad,
  encryptEntry,
  generateDeviceKey,
  generateSalt,
  generateVaultKey,
  hexToBytes,
  kdfParamsFrom,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapVaultKey,
  type DeviceKeyEnvelope,
  type KeyEnvelope,
} from "../src/index.ts";
import { wrapDeviceKeyWithNonce } from "../src/test-only.ts";

const VAULT_A = "vault_01HZX4ALLPASS000000000001";
const VAULT_B = "vault_01HZX4ALLPASS000000000002";
const DEVICE_A = "device_01HZXDEVICE0000000000001";
const DEVICE_B = "device_01HZXDEVICE0000000000002";
const RP_ID = "vault.example.com";

const vk = generateVaultKey();
const plaintext = new TextEncoder().encode('{"title":"example","password":"hunter2"}');

function freshEntry(entryId = "entry_01", vaultId = VAULT_A) {
  return encryptEntry({ vaultKey: vk, vaultId, entryId, plaintext });
}

describe("entry: cross-vault and identity swapping", () => {
  it("rejects decryption under a different vaultId", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry(entry, vk, VAULT_B), AuthFailureError);
  });

  it("rejects an entry whose id was renamed by the server", () => {
    const entry = freshEntry("entry_01");
    const renamed = { ...entry, id: "entry_02" };
    assert.throws(() => decryptEntry(renamed, vk, VAULT_A), AuthFailureError);
  });

  it("rejects ciphertext/tag transplanted onto another entry id", () => {
    const a = freshEntry("entry_01");
    const b = freshEntry("entry_02");
    const franken = { ...b, ciphertext: a.ciphertext, tag: a.tag, nonce: a.nonce };
    assert.throws(() => decryptEntry(franken, vk, VAULT_A), AuthFailureError);
  });

  it("rejects a nonce swapped in from a sibling entry", () => {
    const a = freshEntry("entry_01");
    const b = freshEntry("entry_02");
    const swapped = { ...a, nonce: b.nonce };
    assert.throws(() => decryptEntry(swapped, vk, VAULT_A), AuthFailureError);
  });

  it("rejects decryption under a substituted vault key", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry(entry, generateVaultKey(), VAULT_A), AuthFailureError);
  });
});

describe("entry: version confusion", () => {
  it("rejects a downgraded schemaVersion (also covered in envelope.test)", () => {
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: VAULT_A,
      entryId: "entry_v2",
      plaintext,
      schemaVersion: 2,
    });
    assert.throws(() => decryptEntry({ ...entry, schemaVersion: 1 }, vk, VAULT_A), AuthFailureError);
  });

  it("rejects an unknown cryptoVersion before touching the ciphertext", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry({ ...entry, cryptoVersion: 2 }, vk, VAULT_A), ProtocolError);
  });

  it("rejects schemaVersion 0 on read", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry({ ...entry, schemaVersion: 0 }, vk, VAULT_A), ProtocolError);
  });

  it("refuses to WRITE an entry with a foreign cryptoVersion", () => {
    assert.throws(
      () => encryptEntry({ vaultKey: vk, vaultId: VAULT_A, entryId: "e", plaintext, cryptoVersion: 2 }),
      ProtocolError,
    );
  });

  it("refuses to WRITE an entry with an invalid schemaVersion", () => {
    for (const schemaVersion of [0, -1, 1.5]) {
      assert.throws(
        () => encryptEntry({ vaultKey: vk, vaultId: VAULT_A, entryId: "e", plaintext, schemaVersion }),
        ProtocolError,
      );
    }
  });
});

describe("entry: truncation and malformed input", () => {
  it("rejects a truncated tag", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry({ ...entry, tag: entry.tag.subarray(0, 12) }, vk, VAULT_A), ProtocolError);
  });

  it("rejects truncated ciphertext", () => {
    const entry = freshEntry();
    const cut = { ...entry, ciphertext: entry.ciphertext.subarray(0, entry.ciphertext.length - 1) };
    assert.throws(() => decryptEntry(cut, vk, VAULT_A), AuthFailureError);
  });

  it("rejects extended ciphertext", () => {
    const entry = freshEntry();
    const padded = new Uint8Array(entry.ciphertext.length + 1);
    padded.set(entry.ciphertext);
    assert.throws(() => decryptEntry({ ...entry, ciphertext: padded }, vk, VAULT_A), AuthFailureError);
  });

  it("rejects a wrong-length nonce", () => {
    const entry = freshEntry();
    assert.throws(() => decryptEntry({ ...entry, nonce: entry.nonce.subarray(0, 8) }, vk, VAULT_A), ProtocolError);
  });
});

describe("vault-key envelope: type confusion and cross-vault", () => {
  const wrappingKey = generateDeviceKey();

  it("rejects a recovery envelope re-labelled as master", () => {
    const env = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "recovery" });
    const forged: KeyEnvelope = {
      ...env,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
    };
    assert.throws(() => unwrapVaultKey(forged, wrappingKey, VAULT_A), AuthFailureError);
  });

  it("rejects a device envelope re-labelled as recovery", () => {
    const env = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "device", deviceId: DEVICE_A });
    // Strict shape check fires before any crypto: recovery must not carry deviceId.
    assert.throws(() => unwrapVaultKey({ ...env, type: "recovery" }, wrappingKey, VAULT_A), ProtocolError);
    const { deviceId: _dropped, ...rest } = env;
    assert.throws(() => unwrapVaultKey({ ...rest, type: "recovery" }, wrappingKey, VAULT_A), AuthFailureError);
  });

  it("rejects unwrapping under a different vaultId", () => {
    const env = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "recovery" });
    assert.throws(() => unwrapVaultKey(env, wrappingKey, VAULT_B), AuthFailureError);
  });

  it("rejects a device envelope with a swapped deviceId", () => {
    const env = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "device", deviceId: DEVICE_A });
    assert.throws(() => unwrapVaultKey({ ...env, deviceId: DEVICE_B }, wrappingKey, VAULT_A), AuthFailureError);
  });

  it("rejects tampered version and encryption fields", () => {
    const env = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "recovery" });
    assert.throws(
      () => unwrapVaultKey({ ...env, version: 2 as unknown as 1 }, wrappingKey, VAULT_A),
      ProtocolError,
    );
    assert.throws(
      () => unwrapVaultKey({ ...env, encryption: "AES-128-GCM" as unknown as "AES-256-GCM" }, wrappingKey, VAULT_A),
      ProtocolError,
    );
  });

  it("rejects structurally malformed envelopes", () => {
    const recovery = wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "recovery" });
    const withKdf: KeyEnvelope = { ...recovery, kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()) };
    assert.throws(() => unwrapVaultKey(withKdf, wrappingKey, VAULT_A), ProtocolError);

    const master = wrapVaultKey({
      vaultKey: vk,
      wrappingKey,
      vaultId: VAULT_A,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    const { kdf: _kdf, ...masterNoKdf } = master;
    assert.throws(() => unwrapVaultKey(masterNoKdf as KeyEnvelope, wrappingKey, VAULT_A), ProtocolError);
    assert.throws(() => unwrapVaultKey({ ...master, deviceId: DEVICE_A }, wrappingKey, VAULT_A), ProtocolError);
  });

  it("refuses to WRITE an envelope with a foreign cryptoVersion", () => {
    assert.throws(
      () => wrapVaultKey({ vaultKey: vk, wrappingKey, vaultId: VAULT_A, type: "recovery", cryptoVersion: 2 }),
      ProtocolError,
    );
  });
});

describe("device-key envelope: context binding", () => {
  const prfOutput = hexToBytes("aa".repeat(32));
  const credA = hexToBytes("01".repeat(16));
  const credB = hexToBytes("02".repeat(16));
  const deviceKey = generateDeviceKey();

  function dwk(overrides: Partial<Parameters<typeof deriveDeviceWrappingKey>[0]> = {}) {
    return deriveDeviceWrappingKey({
      prfOutput,
      rpId: RP_ID,
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
      ...overrides,
    });
  }

  function envelope(): DeviceKeyEnvelope {
    return wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: dwk(),
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
    });
  }

  it("every DWK context field is separating (rpId, vaultId, deviceId, credentialId)", () => {
    const base = bytesToHex(dwk());
    assert.notEqual(bytesToHex(dwk({ rpId: "evil.example.com" })), base);
    assert.notEqual(bytesToHex(dwk({ vaultId: VAULT_B })), base);
    assert.notEqual(bytesToHex(dwk({ deviceId: DEVICE_B })), base);
    assert.notEqual(bytesToHex(dwk({ credentialId: credB })), base);
  });

  it("rejects PRF outputs that are not exactly 32 bytes", () => {
    for (const len of [16, 31, 33, 64]) {
      assert.throws(() => dwk({ prfOutput: hexToBytes("ab".repeat(len)) }), ProtocolError);
    }
  });

  it("rejects an envelope whose vaultId was rewritten", () => {
    const env = envelope();
    assert.throws(() => unwrapDeviceKey({ ...env, vaultId: VAULT_B }, dwk()), AuthFailureError);
  });

  it("rejects an envelope whose deviceId was rewritten", () => {
    const env = envelope();
    assert.throws(() => unwrapDeviceKey({ ...env, deviceId: DEVICE_B }, dwk()), AuthFailureError);
  });

  it("rejects credential swapping (envelope field and derived key)", () => {
    const env = envelope();
    assert.throws(() => unwrapDeviceKey({ ...env, credentialId: credB }, dwk()), AuthFailureError);
    assert.throws(() => unwrapDeviceKey(env, dwk({ credentialId: credB })), AuthFailureError);
  });

  it("rejects tampered version and encryption fields", () => {
    const env = envelope();
    assert.throws(() => unwrapDeviceKey({ ...env, version: 2 as unknown as 1 }, dwk()), ProtocolError);
    assert.throws(
      () => unwrapDeviceKey({ ...env, encryption: "AES-128-GCM" as unknown as "AES-256-GCM" }, dwk()),
      ProtocolError,
    );
  });

  it("refuses to WRITE a device-key envelope with a foreign cryptoVersion (both paths)", () => {
    const opts = {
      deviceKey,
      deviceWrappingKey: dwk(),
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
      cryptoVersion: 2,
    };
    assert.throws(() => wrapDeviceKey(opts), ProtocolError);
    assert.throws(() => wrapDeviceKeyWithNonce({ ...opts, nonce: hexToBytes("00".repeat(12)) }), ProtocolError);
  });
});

describe("hostile KDF parameters from a master envelope", () => {
  const wrappingKey = generateVaultKey();

  function masterEnvelope(kdf: ReturnType<typeof kdfParamsFrom>): KeyEnvelope {
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey,
      vaultId: VAULT_A,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    return { ...env, kdf };
  }

  it("accepts the ci profile only with allowTestProfile", () => {
    const env = masterEnvelope(kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()));
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", env), ProtocolError);
    const mk = deriveMasterKeyFromEnvelope("pw", env, { allowTestProfile: true });
    assert.equal(mk.length, 32);
  });

  it("rejects a memory-exhaustion request (multi-GiB) before allocating", () => {
    const env = masterEnvelope({
      ...kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
      memory: 4 * 1024 * 1024, // 4 GiB
    });
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", env), ProtocolError);
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", env, { allowTestProfile: true }), ProtocolError);
  });

  it("rejects a CPU-exhaustion request (absurd iterations)", () => {
    const env = masterEnvelope({
      ...kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
      iterations: 1_000_000,
    });
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", env), ProtocolError);
  });

  it("rejects a swapped KDF algorithm or Argon2 version", () => {
    const good = kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt());
    assert.throws(
      () => deriveMasterKeyFromEnvelope("pw", masterEnvelope({ ...good, algorithm: "pbkdf2" as "argon2id" })),
      ProtocolError,
    );
    assert.throws(
      () => deriveMasterKeyFromEnvelope("pw", masterEnvelope({ ...good, version: 0x10 as 0x13 })),
      ProtocolError,
    );
  });
});

describe("AAD encoding is unambiguous", () => {
  it("field boundaries cannot shift", () => {
    assert.notEqual(bytesToHex(encodeAad(["ab", "c"])), bytesToHex(encodeAad(["a", "bc"])));
    assert.notEqual(bytesToHex(encodeAad(["", "x"])), bytesToHex(encodeAad(["x", ""])));
  });
});
