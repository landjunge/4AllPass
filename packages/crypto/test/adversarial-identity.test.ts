import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  bytesToHex,
  decryptEntry,
  deriveDeviceWrappingKey,
  encryptEntry,
  generateDeviceKey,
  generateVaultKey,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapVaultKey,
  type DeviceKeyEnvelope,
} from "../src/index.ts";
import { C, DKV, VKV, deviceKey, fixtureSnapshot, masterKey, vaultKey } from "./fixtures.ts";
import { loadJson, type DeviceSuite } from "./helpers.ts";

const device = loadJson<DeviceSuite>("device-prf-v1.json").constants;
const credA = new Uint8Array(16).fill(0xa1);
const credB = new Uint8Array(16).fill(0xb2);
const prfOutput = new Uint8Array(32).fill(0x5a);

const VAULT_A = C.vault_id;
const VAULT_B = "vault_01HZX4ALLPASS000000000002";
const DEVICE_A = C.device_id;
const DEVICE_B = "dev_attacker_phone";

function entryIn(vaultId: string, entryId: string, key = vaultKey) {
  return encryptEntry({
    vaultKey: key,
    vaultId,
    entryId,
    vaultKeyVersion: VKV,
    plaintext: new TextEncoder().encode(`{"vault":"${vaultId}","entry":"${entryId}"}`),
  });
}

function deviceKeyEnvelopeFor(vaultId: string, deviceId: string, credentialId: Uint8Array, version = DKV) {
  const dwk = deriveDeviceWrappingKey({
    prfOutput,
    rpId: device.rp_id,
    vaultId,
    deviceId,
    credentialId,
  });
  const envelope = wrapDeviceKey({
    deviceKey: generateDeviceKey(),
    deviceWrappingKey: dwk,
    vaultId,
    deviceId,
    credentialId,
    deviceKeyVersion: version,
  });
  return { dwk, envelope };
}

describe("attack: entry substitution", () => {
  it("refuses entry X served in the slot the caller asked entry Y for", () => {
    const entryX = entryIn(VAULT_A, "entry_X");
    assert.throws(
      () =>
        decryptEntry(entryX, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: "entry_Y",
          vaultKeyVersion: VKV,
        }),
      IntegrityError,
    );
  });

  it("refuses a relabelled entry record", () => {
    const entryX = entryIn(VAULT_A, "entry_X");
    assert.throws(
      () =>
        decryptEntry({ ...entryX, id: "entry_Y" }, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: "entry_Y",
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });
});

describe("attack: cross-vault", () => {
  it("refuses an entry from another vault", () => {
    const foreign = entryIn(VAULT_B, C.entry_id);
    assert.throws(
      () =>
        decryptEntry(foreign, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("refuses a key envelope from another vault", () => {
    const foreign = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId: VAULT_B,
      type: "recovery",
      vaultKeyVersion: VKV,
    });
    assert.throws(
      () =>
        unwrapVaultKey(foreign, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "recovery",
          expectVaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("refuses a Device-Key Envelope minted for another vault, even with its matching DWK", () => {
    const { dwk, envelope } = deviceKeyEnvelopeFor(VAULT_B, DEVICE_A, credA);
    assert.throws(
      () =>
        unwrapDeviceKey(envelope, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_A,
          deviceId: DEVICE_A,
          credentialId: credA,
          deviceKeyVersion: DKV,
        }),
      IntegrityError,
    );
  });

  it("derives a different Device Wrapping Key per vault", () => {
    const a = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
    });
    const b = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_B,
      deviceId: DEVICE_A,
      credentialId: credA,
    });
    assert.notEqual(bytesToHex(a), bytesToHex(b));
  });
});

describe("attack: cross-device", () => {
  it("refuses another device's Device Envelope", () => {
    const foreign = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: VAULT_A,
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: DEVICE_B,
      deviceKeyVersion: DKV,
    });
    assert.throws(
      () =>
        unwrapVaultKey(foreign, {
          wrappingKey: deviceKey,
          vaultId: VAULT_A,
          expectType: "device",
          expectVaultKeyVersion: VKV,
          expectDeviceId: DEVICE_A,
          expectDeviceKeyVersion: DKV,
        }),
      IntegrityError,
    );
  });

  it("refuses a relabelled Device Envelope", () => {
    const foreign = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: VAULT_A,
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: DEVICE_B,
      deviceKeyVersion: DKV,
    });
    assert.throws(
      () =>
        unwrapVaultKey({ ...foreign, deviceId: DEVICE_A }, {
          wrappingKey: deviceKey,
          vaultId: VAULT_A,
          expectType: "device",
          expectVaultKeyVersion: VKV,
          expectDeviceId: DEVICE_A,
          expectDeviceKeyVersion: DKV,
        }),
      AuthFailureError,
    );
  });

  it("refuses another device's Device-Key Envelope", () => {
    const { dwk, envelope } = deviceKeyEnvelopeFor(VAULT_A, DEVICE_B, credA);
    assert.throws(
      () =>
        unwrapDeviceKey(envelope, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_A,
          deviceId: DEVICE_A,
          credentialId: credA,
          deviceKeyVersion: DKV,
        }),
      IntegrityError,
    );
  });

  it("derives a different Device Wrapping Key per device", () => {
    const a = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
    });
    const b = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_A,
      deviceId: DEVICE_B,
      credentialId: credA,
    });
    assert.notEqual(bytesToHex(a), bytesToHex(b));
  });
});

describe("attack: credential swapping", () => {
  it("refuses an envelope whose credentialId was replaced", () => {
    const { dwk, envelope } = deviceKeyEnvelopeFor(VAULT_A, DEVICE_A, credA);
    const swapped: DeviceKeyEnvelope = { ...envelope, credentialId: credB };
    assert.throws(
      () =>
        unwrapDeviceKey(swapped, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_A,
          deviceId: DEVICE_A,
          credentialId: credA,
          deviceKeyVersion: DKV,
        }),
      IntegrityError,
    );
  });

  it("still fails when the caller is lied to about the credential as well", () => {
    const { dwk, envelope } = deviceKeyEnvelopeFor(VAULT_A, DEVICE_A, credA);
    const swapped: DeviceKeyEnvelope = { ...envelope, credentialId: credB };
    assert.throws(
      () =>
        unwrapDeviceKey(swapped, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_A,
          deviceId: DEVICE_A,
          credentialId: credB,
          deviceKeyVersion: DKV,
        }),
      AuthFailureError,
    );
  });

  it("derives a different Device Wrapping Key per credential", () => {
    const a = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credA,
    });
    const b = deriveDeviceWrappingKey({
      prfOutput,
      rpId: device.rp_id,
      vaultId: VAULT_A,
      deviceId: DEVICE_A,
      credentialId: credB,
    });
    assert.notEqual(bytesToHex(a), bytesToHex(b));
  });

  it("refuses an empty or implausibly short credentialId", () => {
    for (const credentialId of [new Uint8Array(0), new Uint8Array(4)]) {
      assert.throws(
        () =>
          deriveDeviceWrappingKey({
            prfOutput,
            rpId: device.rp_id,
            vaultId: VAULT_A,
            deviceId: DEVICE_A,
            credentialId,
          }),
        ProtocolError,
      );
    }
  });
});

describe("attack: key substitution", () => {
  it("refuses a master envelope whose KDF salt was swapped", () => {
    const { master } = fixtureSnapshot();
    assert.ok(master.kdf);
    const swappedSalt = { ...master, kdf: { ...master.kdf, salt: new Uint8Array(16).fill(0xff) } };
    assert.throws(
      () =>
        unwrapVaultKey(swappedSalt, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "master",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      AuthFailureError,
    );
  });

  it("refuses a master envelope whose KDF cost parameters were weakened", () => {
    const { master } = fixtureSnapshot();
    assert.ok(master.kdf);
    const weakened = {
      ...master,
      kdf: { ...master.kdf, memory: 8, iterations: 1, parallelism: 1 },
    };
    assert.throws(
      () =>
        unwrapVaultKey(weakened, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "master",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      AuthFailureError,
    );
  });

  it("refuses metadata injected into envelopes that must not carry it", () => {
    const { master, recovery, device: deviceEnvelope } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    assert.throws(
      () =>
        unwrapVaultKey({ ...master, deviceId: DEVICE_B }, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "master",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        unwrapVaultKey({ ...recovery, kdf: kdfBlock }, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "recovery",
          expectVaultKeyVersion: VKV,
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        unwrapVaultKey({ ...deviceEnvelope, kdf: kdfBlock }, {
          wrappingKey: deviceKey,
          vaultId: VAULT_A,
          expectType: "device",
          expectVaultKeyVersion: VKV,
          expectDeviceId: DEVICE_A,
          expectDeviceKeyVersion: DKV,
        }),
      ProtocolError,
    );
  });

  it("refuses an entire snapshot minted under an attacker's vault key", () => {
    const attackerVaultKey = generateVaultKey();
    const attackerEntry = entryIn(VAULT_A, C.entry_id, attackerVaultKey);
    assert.throws(
      () =>
        decryptEntry(attackerEntry, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });
});

describe("attack: version confusion", () => {
  it("refuses an entry claiming an unsupported crypto version", () => {
    const entry = entryIn(VAULT_A, C.entry_id);
    assert.throws(
      () =>
        decryptEntry({ ...entry, cryptoVersion: 2 }, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV,
        }),
      ProtocolError,
    );
  });

  it("refuses an entry from another vault key generation", () => {
    const entry = entryIn(VAULT_A, C.entry_id);
    assert.throws(
      () =>
        decryptEntry(entry, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV + 1,
        }),
      IntegrityError,
    );
    assert.throws(
      () =>
        decryptEntry({ ...entry, vaultKeyVersion: VKV + 1 }, {
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV + 1,
        }),
      AuthFailureError,
    );
  });

  it("refuses an envelope claiming an unsupported protocol version", () => {
    const { master } = fixtureSnapshot();
    assert.throws(
      () =>
        unwrapVaultKey({ ...master, version: 2 }, {
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          expectType: "master",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      ProtocolError,
    );
  });

  it("refuses to write an envelope or entry under a future protocol version", () => {
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey,
          wrappingKey: masterKey,
          vaultId: VAULT_A,
          type: "recovery",
          vaultKeyVersion: VKV,
          cryptoVersion: 2,
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        encryptEntry({
          vaultKey,
          vaultId: VAULT_A,
          entryId: C.entry_id,
          vaultKeyVersion: VKV,
          cryptoVersion: 2,
          plaintext: new Uint8Array([1]),
        }),
      ProtocolError,
    );
  });

  it("refuses a Device-Key Envelope from an older Device-Key generation", () => {
    const { dwk, envelope } = deviceKeyEnvelopeFor(VAULT_A, DEVICE_A, credA, 1);
    assert.throws(
      () =>
        unwrapDeviceKey(envelope, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_A,
          deviceId: DEVICE_A,
          credentialId: credA,
          deviceKeyVersion: 2,
        }),
      IntegrityError,
    );
  });

  it("refuses a Device Envelope wrapped under an older Device Key generation", () => {
    const stale = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: VAULT_A,
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: DEVICE_A,
      deviceKeyVersion: DKV - 1,
    });
    assert.throws(
      () =>
        unwrapVaultKey(stale, {
          wrappingKey: deviceKey,
          vaultId: VAULT_A,
          expectType: "device",
          expectVaultKeyVersion: VKV,
          expectDeviceId: DEVICE_A,
          expectDeviceKeyVersion: DKV,
        }),
      IntegrityError,
    );
  });
});
