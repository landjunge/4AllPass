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

function prfOutput(fill = 0xaa): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function isZeroed(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

function bind(vaultKey: Uint8Array, overrides: Partial<Parameters<typeof bindDeviceWithPrfOutput>[0]> = {}) {
  return bindDeviceWithPrfOutput({
    prfOutput: prfOutput(),
    vaultKey,
    rpId: C.rp_id,
    vaultId: C.vault_id,
    deviceId: C.device_id,
    credentialId: CRED,
    ...overrides,
  });
}

describe("bindDeviceWithPrfOutput", () => {
  it("produces envelopes that unlock back to the same Vault Key", () => {
    const vaultKey = generateVaultKey();
    const { deviceKeyEnvelope, deviceEnvelope } = bind(vaultKey);

    assert.equal(deviceKeyEnvelope.vaultId, C.vault_id);
    assert.equal(deviceKeyEnvelope.deviceId, C.device_id);
    assert.equal(deviceEnvelope.type, "device");
    assert.equal(deviceEnvelope.deviceId, C.device_id);
    assert.equal(deviceEnvelope.kdf, undefined);

    const unlocked = unwrapVaultKeyWithPrfOutput({
      prfOutput: prfOutput(),
      deviceKeyEnvelope,
      deviceEnvelope,
      rpId: C.rp_id,
      credentialId: CRED,
    });
    assert.deepEqual(unlocked, vaultKey);
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
    const deviceKey = unwrapDeviceKey(deviceKeyEnvelope, dwk);
    assert.notDeepEqual(bytesToHex(deviceKey), bytesToHex(dwk));
    assert.notDeepEqual(bytesToHex(deviceKey), bytesToHex(vaultKey));
    assert.throws(() => unwrapVaultKey(deviceEnvelope, dwk, C.vault_id), AuthFailureError);
    assert.deepEqual(unwrapVaultKey(deviceEnvelope, deviceKey, C.vault_id), vaultKey);
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
    unwrapVaultKeyWithPrfOutput({
      prfOutput: good,
      deviceKeyEnvelope,
      deviceEnvelope,
      rpId: C.rp_id,
    });
    assert.ok(isZeroed(good), "PRF output must be zeroized after a successful unlock");

    const bad = prfOutput(0xbb);
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: bad,
          deviceKeyEnvelope,
          deviceEnvelope,
          rpId: C.rp_id,
        }),
      AuthFailureError,
    );
    assert.ok(isZeroed(bad), "PRF output must be zeroized after a failed unlock");
  });

  it("rejects a PRF output from another origin (rpId is bound into HKDF info)", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: prfOutput(),
          deviceKeyEnvelope,
          deviceEnvelope,
          rpId: "evil.example.com",
        }),
      AuthFailureError,
    );
  });

  it("rejects a credentialId that does not match the envelope", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    const prf = prfOutput();
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: prf,
          deviceKeyEnvelope,
          deviceEnvelope,
          rpId: C.rp_id,
          credentialId: hexToBytes("00112233445566778899aabbccddeeff"),
        }),
      ProtocolError,
    );
    assert.ok(isZeroed(prf));
  });

  it("rejects envelopes from two different devices", () => {
    const vaultKey = generateVaultKey();
    const mine = bind(vaultKey);
    const theirs = bind(vaultKey, { deviceId: "dev_other_profile" });
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: prfOutput(),
          deviceKeyEnvelope: mine.deviceKeyEnvelope,
          deviceEnvelope: theirs.deviceEnvelope,
          rpId: C.rp_id,
        }),
      ProtocolError,
    );
  });

  it("rejects a master envelope handed over as a device envelope", () => {
    const vaultKey = generateVaultKey();
    const { deviceKeyEnvelope } = bind(vaultKey);
    const forged = { ...deviceKeyEnvelope };
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: prfOutput(),
          deviceKeyEnvelope: forged,
          deviceEnvelope: {
            version: 1,
            type: "recovery",
            encryption: "AES-256-GCM",
            nonce: new Uint8Array(12),
            ciphertext: new Uint8Array(32),
            tag: new Uint8Array(16),
          },
          rpId: C.rp_id,
        }),
      ProtocolError,
    );
  });

  it("aborts on a short PRF result instead of padding it", () => {
    const { deviceKeyEnvelope, deviceEnvelope } = bind(generateVaultKey());
    assert.throws(
      () =>
        unwrapVaultKeyWithPrfOutput({
          prfOutput: new Uint8Array(16).fill(0xaa),
          deviceKeyEnvelope,
          deviceEnvelope,
          rpId: C.rp_id,
        }),
      ProtocolError,
    );
  });
});

describe("fallback ranks 2 and 3", () => {
  it("unlocks from a stored wrapping key and zeroizes the copy", () => {
    const vaultKey = generateVaultKey();
    const storageKey = generateDeviceKey();
    const deviceKey = generateDeviceKey();
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: storageKey,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: CRED,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: C.vault_id,
      type: "device",
      deviceId: C.device_id,
    });

    const copy = storageKey.slice();
    const unlocked = unwrapVaultKeyWithDeviceWrappingKey(deviceKeyEnvelope, deviceEnvelope, copy);
    assert.deepEqual(unlocked, vaultKey);
    assert.ok(isZeroed(copy), "the wrapping-key copy must be zeroized");
  });

  it("refuses a stored wrapping key that belongs to another device", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = generateDeviceKey();
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: generateDeviceKey(),
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: CRED,
    });
    const otherDeviceEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: C.vault_id,
      type: "device",
      deviceId: "dev_other_profile",
    });
    assert.throws(
      () =>
        unwrapVaultKeyWithDeviceWrappingKey(
          deviceKeyEnvelope,
          otherDeviceEnvelope,
          generateDeviceKey(),
        ),
      ProtocolError,
    );
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
