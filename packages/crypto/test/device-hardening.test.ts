import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  bytesToHex,
  deriveDeviceWrappingKey,
  randomBytes,
  unwrapDeviceKey,
  wrapDeviceKey,
} from "../src/index.ts";

const RP = "pass.example.local";
const VAULT = "vault_dev";
const DEVICE = "dev-1";
const PRF = new Uint8Array(32).fill(0xaa);
const CRED = new Uint8Array(16).fill(0xbe);
const DKV = 1;

/** What the caller expects to be opening. A mismatch is an IntegrityError. */
const EXPECTED = { vaultId: VAULT, deviceId: DEVICE, credentialId: CRED, deviceKeyVersion: DKV };

function baselineDwk() {
  return deriveDeviceWrappingKey({
    prfOutput: PRF,
    rpId: RP,
    vaultId: VAULT,
    deviceId: DEVICE,
    credentialId: CRED,
  });
}

describe("DWK binding — negative cases", () => {
  const baseline = bytesToHex(baselineDwk());

  it("a different rpId yields a different DWK", () => {
    const other = deriveDeviceWrappingKey({
      prfOutput: PRF,
      rpId: "evil.example",
      vaultId: VAULT,
      deviceId: DEVICE,
      credentialId: CRED,
    });
    assert.notEqual(bytesToHex(other), baseline);
  });

  it("a different credentialId yields a different DWK", () => {
    const other = deriveDeviceWrappingKey({
      prfOutput: PRF,
      rpId: RP,
      vaultId: VAULT,
      deviceId: DEVICE,
      credentialId: new Uint8Array(16).fill(0x11),
    });
    assert.notEqual(bytesToHex(other), baseline);
  });

  it("a different deviceId yields a different DWK", () => {
    const other = deriveDeviceWrappingKey({
      prfOutput: PRF,
      rpId: RP,
      vaultId: VAULT,
      deviceId: "dev-2",
      credentialId: CRED,
    });
    assert.notEqual(bytesToHex(other), baseline);
  });

  it("rejects an unsupported crypto version (L1)", () => {
    assert.throws(
      () =>
        deriveDeviceWrappingKey({
          prfOutput: PRF,
          rpId: RP,
          vaultId: VAULT,
          deviceId: DEVICE,
          credentialId: CRED,
          cryptoVersion: 2,
        }),
      ProtocolError,
    );
  });
});

describe("Device-Key Envelope — tamper", () => {
  function envelope() {
    const dwk = randomBytes(32);
    const deviceKey = randomBytes(32);
    const env = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: dwk,
      vaultId: VAULT,
      deviceId: DEVICE,
      credentialId: CRED,
      deviceKeyVersion: DKV,
    });
    return { env, dwk, deviceKey };
  }

  it("unwraps cleanly when untampered", () => {
    const { env, dwk, deviceKey } = envelope();
    assert.deepEqual(unwrapDeviceKey(env, { deviceWrappingKey: dwk, ...EXPECTED }), deviceKey);
  });

  it("a tampered deviceId in the envelope fails to unwrap", () => {
    const { env, dwk } = envelope();
    // The caller states the device it expects, so a relabelled envelope is
    // rejected as a substitution before the tag is even checked.
    assert.throws(
      () => unwrapDeviceKey({ ...env, deviceId: "evil-device" }, { deviceWrappingKey: dwk, ...EXPECTED }),
      IntegrityError,
    );
    // Lying to the caller as well only moves the failure to the AAD.
    assert.throws(
      () =>
        unwrapDeviceKey(
          { ...env, deviceId: "evil-device" },
          { deviceWrappingKey: dwk, ...EXPECTED, deviceId: "evil-device" },
        ),
      AuthFailureError,
    );
  });

  it("a tampered credentialId in the envelope fails to unwrap", () => {
    const { env, dwk } = envelope();
    const swapped = new Uint8Array(16).fill(0x00);
    assert.throws(
      () => unwrapDeviceKey({ ...env, credentialId: swapped }, { deviceWrappingKey: dwk, ...EXPECTED }),
      IntegrityError,
    );
    assert.throws(
      () =>
        unwrapDeviceKey(
          { ...env, credentialId: swapped },
          { deviceWrappingKey: dwk, ...EXPECTED, credentialId: swapped },
        ),
      AuthFailureError,
    );
  });

  it("a tampered vaultId in the envelope fails to unwrap", () => {
    const { env, dwk } = envelope();
    assert.throws(
      () => unwrapDeviceKey({ ...env, vaultId: "vault_OTHER" }, { deviceWrappingKey: dwk, ...EXPECTED }),
      IntegrityError,
    );
    assert.throws(
      () =>
        unwrapDeviceKey(
          { ...env, vaultId: "vault_OTHER" },
          { deviceWrappingKey: dwk, ...EXPECTED, vaultId: "vault_OTHER" },
        ),
      AuthFailureError,
    );
  });
});
