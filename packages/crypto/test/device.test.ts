import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  bytesToHex,
  deriveDeviceWrappingKey,
  hexToBytes,
  prfEvalFirst,
  unwrapDeviceKey,
} from "../src/index.ts";
import { wrapDeviceKeyWithNonce } from "../src/test-only.ts";
import { decrypt } from "../src/aead/aes-gcm.ts";
import { loadJson, type DeviceSuite } from "./helpers.ts";

const suite = loadJson<DeviceSuite>("device-prf-v1.json");
const C = suite.constants;
const cred = hexToBytes(C.credential_id);
const prfOut = hexToBytes(C.prf_output);

function req(v: Record<string, string>, key: string): string {
  const value = v[key];
  assert.ok(value, key);
  return value;
}

function find(id: string): Record<string, string> {
  const v = suite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

function negative(id: string): Record<string, string> {
  const v = suite.negative.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

describe("WebAuthn PRF → DWK", () => {
  it("TV-PRF-EVAL-FIRST", () => {
    const v = find("TV-PRF-EVAL-FIRST");
    assert.equal(bytesToHex(prfEvalFirst(C.rp_id, C.vault_id)), req(v, "prf_eval_first"));
  });

  it("TV-DWK-01", () => {
    const v = find("TV-DWK-01");
    const dwk = deriveDeviceWrappingKey({
      prfOutput: prfOut,
      rpId: C.rp_id,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: cred,
    });
    assert.equal(bytesToHex(dwk), req(v, "device_wrapping_key"));
  });

  it("TV-DWK-WRONG-VAULT differs", () => {
    const expected = req(find("TV-DWK-01"), "device_wrapping_key");
    const other = deriveDeviceWrappingKey({
      prfOutput: prfOut,
      rpId: C.rp_id,
      vaultId: "vault_OTHER",
      deviceId: C.device_id,
      credentialId: cred,
    });
    assert.notEqual(bytesToHex(other), expected);
  });
});

describe("Device Key envelope", () => {
  const expectations = {
    vaultId: C.vault_id,
    deviceId: C.device_id,
    credentialId: cred,
    deviceKeyVersion: C.device_key_version,
  };

  it("TV-DKE-01 wrap / unwrap", () => {
    const v = find("TV-DKE-01");
    const dwk = hexToBytes(req(v, "key"));
    const env = wrapDeviceKeyWithNonce({
      deviceKey: hexToBytes(C.device_key),
      deviceWrappingKey: dwk,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: cred,
      deviceKeyVersion: C.device_key_version,
      nonce: hexToBytes(req(v, "nonce")),
    });
    assert.equal(bytesToHex(env.ciphertext), req(v, "ciphertext"));
    assert.equal(bytesToHex(env.tag), req(v, "tag"));
    assert.equal(env.deviceKeyVersion, C.device_key_version);
    assert.deepEqual(
      unwrapDeviceKey(env, { deviceWrappingKey: dwk, ...expectations }),
      hexToBytes(C.device_key),
    );
  });

  for (const id of ["TV-DKE-WRONG-DWK", "TV-DKE-CREDENTIAL-SWAP", "TV-DKE-VERSION-ROLLBACK"]) {
    it(`${id} fails authentication`, () => {
      const v = negative(id);
      assert.throws(
        () =>
          decrypt(
            hexToBytes(req(v, "key")),
            hexToBytes(req(v, "nonce")),
            hexToBytes(req(v, "ciphertext")),
            hexToBytes(req(v, "tag")),
            hexToBytes(req(v, "aad")),
          ),
        AuthFailureError,
      );
    });
  }
});
