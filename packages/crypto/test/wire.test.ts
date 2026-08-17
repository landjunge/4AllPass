import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  base64ToBytes,
  bytesToBase64,
  decodeDeviceKeyEnvelope,
  decodeEncryptedEntry,
  decodeKeyEnvelope,
  decodeVaultSnapshot,
  encodeDeviceKeyEnvelope,
  encodeEncryptedEntry,
  encodeKeyEnvelope,
  encodeVaultSnapshot,
  encryptEntry,
  generateDeviceKey,
  generateSalt,
  generateVaultKey,
  hexToBytes,
  kdfParamsFrom,
  ProtocolError,
  wrapDeviceKey,
  wrapVaultKey,
} from "../src/index.ts";

const VAULT_ID = "vault_01HZX4ALLPASS000000000001";
const DEVICE_ID = "dev_macbook_chrome_profile_1";
const CRED = hexToBytes("cafebabecafebabecafebabecafebabe");

function roundTrip<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function masterEnvelope() {
  return wrapVaultKey({
    vaultKey: generateVaultKey(),
    wrappingKey: generateDeviceKey(),
    vaultId: VAULT_ID,
    type: "master",
    kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt(32)),
  });
}

function deviceEnvelope() {
  return wrapVaultKey({
    vaultKey: generateVaultKey(),
    wrappingKey: generateDeviceKey(),
    vaultId: VAULT_ID,
    type: "device",
    deviceId: DEVICE_ID,
  });
}

describe("base64", () => {
  it("round-trips every length up to 64 bytes", () => {
    for (let n = 0; n <= 64; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + n) & 0xff;
      assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
    }
  });

  it("matches known encodings", () => {
    assert.equal(bytesToBase64(new TextEncoder().encode("4allpass")), "NGFsbHBhc3M=");
    assert.deepEqual(base64ToBytes("NGFsbHBhc3M="), new TextEncoder().encode("4allpass"));
  });

  it("rejects base64url, whitespace, and bad padding", () => {
    for (const bad of ["ab-_", "AAA", "AA==AA==", "A A=", "////=", "AB=="]) {
      assert.throws(() => base64ToBytes(bad), ProtocolError, bad);
    }
  });
});

describe("key envelope wire format", () => {
  it("round-trips a master envelope including KDF parameters", () => {
    const envelope = masterEnvelope();
    const decoded = decodeKeyEnvelope(roundTrip(encodeKeyEnvelope(envelope)));
    assert.deepEqual(decoded, envelope);
    assert.equal(decoded.kdf?.memory, ARGON2ID_PROFILES.standard.memory);
    assert.equal(decoded.kdf?.salt.length, 32);
  });

  it("round-trips a device envelope", () => {
    const envelope = deviceEnvelope();
    assert.deepEqual(decodeKeyEnvelope(roundTrip(encodeKeyEnvelope(envelope))), envelope);
  });

  it("rejects a master envelope without KDF parameters", () => {
    const wire = encodeKeyEnvelope(masterEnvelope());
    delete wire.kdf;
    assert.throws(() => decodeKeyEnvelope(wire), ProtocolError);
  });

  it("rejects a device envelope that carries KDF parameters", () => {
    const wire = encodeKeyEnvelope(deviceEnvelope());
    wire.kdf = encodeKeyEnvelope(masterEnvelope()).kdf!;
    assert.throws(() => decodeKeyEnvelope(wire), ProtocolError);
  });

  it("rejects a device envelope without deviceId", () => {
    const wire = encodeKeyEnvelope(deviceEnvelope());
    delete wire.deviceId;
    assert.throws(() => decodeKeyEnvelope(wire), ProtocolError);
    assert.throws(() => decodeKeyEnvelope({ ...wire, deviceId: null }), ProtocolError);
  });

  it("treats an explicit null optional field as absent", () => {
    const master = masterEnvelope();
    const decoded = decodeKeyEnvelope({ ...encodeKeyEnvelope(master), deviceId: null });
    assert.deepEqual(decoded, master);

    const device = deviceEnvelope();
    assert.deepEqual(decodeKeyEnvelope({ ...encodeKeyEnvelope(device), kdf: null }), device);
  });

  it("rejects unknown versions, bad nonce and tag lengths, and non-32-byte payloads", () => {
    const base = encodeKeyEnvelope(deviceEnvelope());
    assert.throws(() => decodeKeyEnvelope({ ...base, version: 2 }), ProtocolError);
    assert.throws(() => decodeKeyEnvelope({ ...base, type: "admin" }), ProtocolError);
    assert.throws(() => decodeKeyEnvelope({ ...base, encryption: "AES-128-GCM" }), ProtocolError);
    assert.throws(
      () => decodeKeyEnvelope({ ...base, nonce: bytesToBase64(new Uint8Array(11)) }),
      ProtocolError,
    );
    assert.throws(
      () => decodeKeyEnvelope({ ...base, tag: bytesToBase64(new Uint8Array(15)) }),
      ProtocolError,
    );
    assert.throws(
      () => decodeKeyEnvelope({ ...base, ciphertext: bytesToBase64(new Uint8Array(48)) }),
      ProtocolError,
    );
    assert.throws(() => decodeKeyEnvelope(null), ProtocolError);
    assert.throws(() => decodeKeyEnvelope([base]), ProtocolError);
  });

  it("rejects a KDF profile below the Argon2id floor of the format", () => {
    const wire = encodeKeyEnvelope(masterEnvelope());
    assert.ok(wire.kdf);
    assert.throws(
      () => decodeKeyEnvelope({ ...wire, kdf: { ...wire.kdf, iterations: 0 } }),
      ProtocolError,
    );
    assert.throws(
      () => decodeKeyEnvelope({ ...wire, kdf: { ...wire.kdf, hashLen: 64 } }),
      ProtocolError,
    );
    assert.throws(
      () => decodeKeyEnvelope({ ...wire, kdf: { ...wire.kdf, version: 0x10 } }),
      ProtocolError,
    );
    assert.throws(
      () => decodeKeyEnvelope({ ...wire, kdf: { ...wire.kdf, salt: bytesToBase64(new Uint8Array(8)) } }),
      ProtocolError,
    );
  });
});

describe("device-key envelope wire format", () => {
  it("round-trips including the raw credential id", () => {
    const envelope = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: generateDeviceKey(),
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      credentialId: CRED,
    });
    const decoded = decodeDeviceKeyEnvelope(roundTrip(encodeDeviceKeyEnvelope(envelope)));
    assert.deepEqual(decoded, envelope);
  });

  it("rejects a missing credential id or vault id", () => {
    const wire = encodeDeviceKeyEnvelope(
      wrapDeviceKey({
        deviceKey: generateDeviceKey(),
        deviceWrappingKey: generateDeviceKey(),
        vaultId: VAULT_ID,
        deviceId: DEVICE_ID,
        credentialId: CRED,
      }),
    );
    assert.throws(() => decodeDeviceKeyEnvelope({ ...wire, credentialId: "" }), ProtocolError);
    assert.throws(() => decodeDeviceKeyEnvelope({ ...wire, vaultId: "" }), ProtocolError);
  });
});

describe("entry and snapshot wire format", () => {
  const vaultKey = generateVaultKey();

  function entry(id: string, schemaVersion?: number) {
    return encryptEntry({
      vaultKey,
      vaultId: VAULT_ID,
      entryId: id,
      plaintext: new TextEncoder().encode(`{"title":"${id}"}`),
      ...(schemaVersion === undefined ? {} : { schemaVersion }),
    });
  }

  it("round-trips an entry and keeps its stored schemaVersion", () => {
    const original = entry("entry_1", 3);
    const decoded = decodeEncryptedEntry(roundTrip(encodeEncryptedEntry(original)));
    assert.deepEqual(decoded, original);
    assert.equal(decoded.schemaVersion, 3);
  });

  it("round-trips a full snapshot", () => {
    const snapshot = {
      vaultId: VAULT_ID,
      revision: 7,
      vaultKeyVersion: 2,
      cryptoProtocolVersion: 1 as const,
      envelopes: [masterEnvelope(), deviceEnvelope()],
      entries: [entry("entry_1"), entry("entry_2")],
    };
    const decoded = decodeVaultSnapshot(roundTrip(encodeVaultSnapshot(snapshot)));
    assert.deepEqual(decoded, snapshot);
  });

  it("rejects snapshots with revision 0 or a foreign protocol version", () => {
    const wire = encodeVaultSnapshot({
      vaultId: VAULT_ID,
      revision: 1,
      vaultKeyVersion: 1,
      cryptoProtocolVersion: 1,
      envelopes: [masterEnvelope()],
      entries: [],
    });
    assert.throws(() => decodeVaultSnapshot({ ...wire, revision: 0 }), ProtocolError);
    assert.throws(() => decodeVaultSnapshot({ ...wire, vaultKeyVersion: 0 }), ProtocolError);
    assert.throws(() => decodeVaultSnapshot({ ...wire, cryptoProtocolVersion: 2 }), ProtocolError);
    assert.throws(() => decodeVaultSnapshot({ ...wire, entries: {} }), ProtocolError);
  });
});
