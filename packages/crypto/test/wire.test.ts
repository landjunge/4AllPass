import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_WIRE_KEYS,
  ProtocolError,
  deviceKeyEnvelopeFromWire,
  deviceKeyEnvelopeToWire,
  hexToBytes,
  keyEnvelopeFromWire,
  keyEnvelopeToWire,
  unwrapDeviceKey,
  unwrapVaultKey,
} from "../src/index.ts";
import { wrapDeviceKeyWithNonce, wrapVaultKeyWithNonce } from "../src/test-only.ts";
import { loadJson } from "./helpers.ts";

interface AesSuite {
  constants: {
    vault_id: string;
    device_id: string;
    vault_key: string;
    device_key: string;
  };
  success: Array<{ id: string; nonce: string; ciphertext: string; tag: string }>;
}

interface PrfSuite {
  constants: {
    vault_id: string;
    device_id: string;
    credential_id: string;
    device_key: string;
  };
  success: Array<Record<string, string>>;
}

const aes = loadJson<AesSuite>("aes-gcm-v1.json");
const prf = loadJson<PrfSuite>("device-prf-v1.json");

function req(v: Record<string, string>, key: string): string {
  const value = v[key];
  assert.ok(value, key);
  return value;
}

describe("envelope wire format", () => {
  it("round-trips a device envelope without exposing DK or VK", () => {
    const v = aes.success.find((x) => x.id === "TV-ENV-DEVICE");
    assert.ok(v);
    const env = wrapVaultKeyWithNonce({
      vaultKey: hexToBytes(aes.constants.vault_key),
      wrappingKey: hexToBytes(aes.constants.device_key),
      vaultId: aes.constants.vault_id,
      type: "device",
      deviceId: aes.constants.device_id,
      nonce: hexToBytes(v.nonce),
    });
    const wire = keyEnvelopeToWire(env);
    assert.equal(wire.type, "device");
    assert.equal(wire.deviceId, aes.constants.device_id);
    for (const key of FORBIDDEN_WIRE_KEYS) {
      assert.equal(Object.hasOwn(wire, key), false);
    }
    const parsed = keyEnvelopeFromWire(wire);
    assert.deepEqual(
      unwrapVaultKey(parsed, hexToBytes(aes.constants.device_key), aes.constants.vault_id),
      hexToBytes(aes.constants.vault_key),
    );
  });

  it("rejects plaintext key fields on the wire", () => {
    assert.throws(
      () =>
        keyEnvelopeFromWire({
          version: 1,
          type: "device",
          deviceId: "dev",
          encryption: "AES-256-GCM",
          nonce: "AAAAAAAAAAAAAAAA",
          ciphertext: "AA",
          tag: "AAAAAAAAAAAAAAAAAAAAAA",
          vaultKey: "leak",
        }),
      ProtocolError,
    );
  });
});

describe("device-key envelope wire format", () => {
  it("round-trips TV-DKE-01", () => {
    const v = prf.success.find((x) => x.id === "TV-DKE-01");
    assert.ok(v);
    const env = wrapDeviceKeyWithNonce({
      deviceKey: hexToBytes(prf.constants.device_key),
      deviceWrappingKey: hexToBytes(req(v, "key")),
      vaultId: prf.constants.vault_id,
      deviceId: prf.constants.device_id,
      credentialId: hexToBytes(prf.constants.credential_id),
      nonce: hexToBytes(req(v, "nonce")),
    });
    const parsed = deviceKeyEnvelopeFromWire(deviceKeyEnvelopeToWire(env));
    assert.deepEqual(unwrapDeviceKey(parsed, hexToBytes(req(v, "key"))), hexToBytes(prf.constants.device_key));
  });
});
