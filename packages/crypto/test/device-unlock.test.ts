import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  bindDeviceWithPrfOutput,
  bytesToHex,
  deriveDeviceWrappingKey,
  generateDeviceKey,
  generateVaultKey,
  hexToBytes,
  IntegrityError,
  ProtocolError,
  prfEvalFirst,
  unwrapDeviceKey,
  unwrapVaultKey,
  unwrapVaultKeyWithDeviceWrappingKey,
  unwrapVaultKeyWithPrfOutput,
  wrapDeviceKey,
  wrapVaultKey,
} from "../src/index.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: {
    vault_id: string;
    device_id: string;
    rp_id: string;
    credential_id: string;
    prf_output: string;
  };
}

const C = loadJson<Suite>("device-prf-v1.json").constants;
const CRED = hexToBytes(C.credential_id);
const VAULT_KEY_VERSION = 1;
const DEVICE_KEY_VERSION = 1;

/** What an honest caller states about the device it is unlocking. */
const EXPECT = {
  vaultId: C.vault_id,
  deviceId: C.device_id,
  credentialId: CRED,
  deviceKeyVersion: DEVICE_KEY_VERSION,
  vaultKeyVersion: VAULT_KEY_VERSION,
};

function prfOutput(fill = 0xaa): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function isZeroed(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

function bind(
  vaultKey: Uint8Array,
  overrides: Partial<Parameters<typeof bindDeviceWithPrfOutput>[0]> = {},
) {
  return bindDeviceWithPrfOutput({
    prfOutput: prfOutput(),
    vaultKey,
    rpId: C.rp_id,
    vaultId: C.vault_id,
    deviceId: C.device_id,
    credentialId: CRED,
    vaultKeyVersion: VAULT_KEY_VERSION,
    deviceKeyVersion: DEVICE_KEY_VERSION,
    ...overrides,
  });
}

function unlock(overrides: Partial<Parameters<typeof unwrapVaultKeyWithPrfOutput>[0]>) {
  return unwrapVaultKeyWithPrfOutput({
    prfOutput: prfOutput(),
    rpId: C.rp_id,
    ...EXPECT,
    ...overrides,
  } as Parameters<typeof unwrapVaultKeyWithPrfOutput>[0]);
}

describe("bindDeviceWithPrfOutput", () => {
  it("produces envelopes that unlock back to the same Vault Key", () => {
    const vaultKey = generateVaultKey();
    const { deviceKeyEnvelope, deviceEnvelope } = bind(vaultKey);

    assert.equal(deviceKeyEnvelope.vaultId, C.vault_id);
    assert.equal(deviceKeyEnvelope.deviceId, C.device_id);
    assert.equal(deviceKeyEnvelope.deviceKeyVersion, DEVICE_KEY_VERSION);
    assert.equal(deviceEnvelope.type, "device");
    assert.equal(deviceEnvelope.deviceId, C.device_id);
    assert.equal(deviceEnvelope.vaultKeyVersion, VAULT_KEY_VERSION);
    assert.equal(deviceEnvelope.deviceKeyVersion, DEVICE_KEY_VERSION);
    assert.equal(deviceEnvelope.kdf, undefined);

    assert.deepEqual(unlock({ deviceKeyEnvelope, deviceEnvelope }), vaultKey);
  });

  it("zeroizes the PRF output it was handed", () => {
    const prf = prfOutput();
    bind(generateVaultKey(), { prfOutput: prf });
    assert.ok(isZeroed(prf), "PRF output must not survive registration");
  });

  it("never wraps the Vault Key under the DWK itself", () => {
    const vaultKey = generateVaultKey();
    const { deviceKeyEnvelope, deviceEnvelope } = bind(vaultKey);
    const dwk = deriveDeviceWrappingKey({
      prfOutput: prfOutput(),
      rpId: C.rp_id,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: CRED,
    });

    // The DWK opens the Device-Key Envelope and nothing else.
    const deviceKey = unwrapDeviceKey(deviceKeyEnvelope, {
      deviceWrappingKey: dwk,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: CRED,
      deviceKeyVersion: DEVICE_KEY_VERSION,
    });
    assert.notDeepEqual(bytesToHex(deviceKey), bytesToHex(dwk));
    assert.notDeepEqual(bytesToHex(deviceKey), bytesToHex(vaultKey));

    const openDeviceEnvelope = (wrappingKey: Uint8Array) =>
      unwrapVaultKey(deviceEnvelope, {
        wrappingKey,
        vaultId: C.vault_id,
        expectType: "device",
        expectVaultKeyVersion: VAULT_KEY_VERSION,
        expectDeviceId: C.device_id,
        expectDeviceKeyVersion: DEVICE_KEY_VERSION,
      });
    assert.throws(() => openDeviceEnvelope(dwk), AuthFailureError);
    assert.deepEqual(openDeviceEnvelope(deviceKey), vaultKey);
  });

  it("gives every device its own Device Key", () => {
    const vaultKey = generateVaultKey();
    const first = bind(vaultKey);
    const second = bind(vaultKey, { deviceId: "dev_second_profile" });
    assert.notEqual(
      bytesToHex(first.deviceKeyEnvelope.ciphertext),
      bytesToHex(second.deviceKeyEnvelope.ciphertext),
    );
    assert.notEqual(
      bytesToHex(first.deviceEnvelope.ciphertext),
      bytesToHex(second.deviceEnvelope.ciphertext),
    );
  });
});

describe("unwrapVaultKeyWithPrfOutput", () => {
  it("zeroizes the PRF output on success and on failure", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());

    const good = prfOutput();
    unlock({ prfOutput: good, deviceKeyEnvelope, deviceEnvelope });
    assert.ok(isZeroed(good), "PRF output must be zeroized after a successful unlock");

    const bad = prfOutput(0xbb);
    assert.throws(
      () => unlock({ prfOutput: bad, deviceKeyEnvelope, deviceEnvelope }),
      AuthFailureError,
    );
    assert.ok(isZeroed(bad), "PRF output must be zeroized after a failed unlock");
  });

  it("zeroizes the PRF output even when the stated identity is rejected", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    const prf = prfOutput();
    assert.throws(
      () => unlock({ prfOutput: prf, deviceKeyEnvelope, deviceEnvelope, deviceKeyVersion: 0 }),
      ProtocolError,
    );
    assert.ok(isZeroed(prf), "a rejected expectation must not leave the PRF output behind");
  });

  it("reports a non-Uint8Array PRF output as such", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    // Wiping the caller's material must not turn the real error into a TypeError.
    assert.throws(
      () =>
        unlock({
          prfOutput: "not-bytes" as unknown as Uint8Array,
          deviceKeyEnvelope,
          deviceEnvelope,
        }),
      ProtocolError,
    );
  });

  it("rejects a PRF output from another origin (rpId is bound into HKDF info)", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    assert.throws(
      () => unlock({ deviceKeyEnvelope, deviceEnvelope, rpId: "evil.example.com" }),
      AuthFailureError,
    );
  });

  it("rejects a credentialId that does not match the envelope", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    const prf = prfOutput();
    assert.throws(
      () =>
        unlock({
          prfOutput: prf,
          deviceKeyEnvelope,
          deviceEnvelope,
          credentialId: hexToBytes("00112233445566778899aabbccddeeff"),
        }),
      IntegrityError,
    );
    assert.ok(isZeroed(prf));
  });

  it("rejects envelopes from two different devices", () => {
    const vaultKey = generateVaultKey();
    const mine = bind(vaultKey);
    const theirs = bind(vaultKey, { deviceId: "dev_other_profile" });
    assert.throws(
      () =>
        unlock({
          deviceKeyEnvelope: mine.deviceKeyEnvelope,
          deviceEnvelope: theirs.deviceEnvelope,
        }),
      IntegrityError,
    );
  });

  it("rejects a recovery envelope handed over as a device envelope", () => {
    const { deviceKeyEnvelope } = bind(generateVaultKey());
    assert.throws(
      () =>
        unlock({
          deviceKeyEnvelope,
          deviceEnvelope: {
            version: 1,
            type: "recovery",
            vaultKeyVersion: VAULT_KEY_VERSION,
            encryption: "AES-256-GCM",
            nonce: new Uint8Array(12),
            ciphertext: new Uint8Array(32),
            tag: new Uint8Array(16),
          },
        }),
      IntegrityError,
    );
  });

  it("rejects a Device-Key Envelope from an older Device-Key generation", () => {
    const vaultKey = generateVaultKey();
    const rotated = bind(vaultKey, { deviceKeyVersion: 2 });
    assert.throws(
      () =>
        unlock({
          deviceKeyEnvelope: rotated.deviceKeyEnvelope,
          deviceEnvelope: rotated.deviceEnvelope,
        }),
      IntegrityError,
    );
  });

  it("aborts on a short PRF result instead of padding it", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    assert.throws(
      () =>
        unlock({
          prfOutput: new Uint8Array(16).fill(0xaa),
          deviceKeyEnvelope,
          deviceEnvelope,
        }),
      ProtocolError,
    );
  });
});

describe("fallback ranks 2 and 3", () => {
  function localBinding(vaultKey: Uint8Array, deviceId = C.device_id) {
    const storageKey = generateDeviceKey();
    const deviceKey = generateDeviceKey();
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: storageKey,
      vaultId: C.vault_id,
      deviceId,
      credentialId: CRED,
      deviceKeyVersion: DEVICE_KEY_VERSION,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: C.vault_id,
      type: "device",
      vaultKeyVersion: VAULT_KEY_VERSION,
      deviceId,
      deviceKeyVersion: DEVICE_KEY_VERSION,
    });
    return { storageKey, deviceKeyEnvelope, deviceEnvelope };
  }

  it("unlocks from a stored wrapping key and zeroizes the copy", () => {
    const vaultKey = generateVaultKey();
    const { storageKey, deviceKeyEnvelope, deviceEnvelope } = localBinding(vaultKey);

    const copy = storageKey.slice();
    const unlocked = unwrapVaultKeyWithDeviceWrappingKey({
      deviceKeyEnvelope,
      deviceEnvelope,
      deviceWrappingKey: copy,
      ...EXPECT,
    });
    assert.deepEqual(unlocked, vaultKey);
    assert.ok(isZeroed(copy), "the wrapping-key copy must be zeroized");
  });

  it("refuses a device envelope that belongs to another device", () => {
    const vaultKey = generateVaultKey();
    const mine = localBinding(vaultKey);
    const theirs = localBinding(vaultKey, "dev_other_profile");
    assert.throws(
      () =>
        unwrapVaultKeyWithDeviceWrappingKey({
          deviceKeyEnvelope: mine.deviceKeyEnvelope,
          deviceEnvelope: theirs.deviceEnvelope,
          deviceWrappingKey: mine.storageKey.slice(),
          ...EXPECT,
        }),
      IntegrityError,
    );
  });

  it("refuses a stored wrapping key that does not open the envelope", () => {
    const vaultKey = generateVaultKey();
    const { deviceKeyEnvelope, deviceEnvelope } = localBinding(vaultKey);
    assert.throws(
      () =>
        unwrapVaultKeyWithDeviceWrappingKey({
          deviceKeyEnvelope,
          deviceEnvelope,
          deviceWrappingKey: generateDeviceKey(),
          ...EXPECT,
        }),
      AuthFailureError,
    );
  });

  it("zeroizes the stored wrapping key even when the stated identity is rejected", () => {
    const { deviceKeyEnvelope, deviceEnvelope, storageKey } = localBinding(generateVaultKey());
    const copy = storageKey.slice();
    assert.throws(
      () =>
        unwrapVaultKeyWithDeviceWrappingKey({
          deviceKeyEnvelope,
          deviceEnvelope,
          deviceWrappingKey: copy,
          ...EXPECT,
          deviceKeyVersion: 0,
        }),
      ProtocolError,
    );
    assert.ok(isZeroed(copy), "a rejected expectation must not leave the wrapping key behind");
  });
});

describe("prfEvalFirst", () => {
  it("is 32 bytes and vault-specific", () => {
    const a = prfEvalFirst(C.rp_id, C.vault_id);
    const b = prfEvalFirst(C.rp_id, "vault_other");
    assert.equal(a.length, 32);
    assert.notEqual(bytesToHex(a), bytesToHex(b));
  });
});
