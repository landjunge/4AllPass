import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bytesToHex, hexToBytes } from "../src/encoding/bytes.ts";
import {
  deviceKeyAad,
  encodeAad,
  entryAad,
  envelopeAad,
  manifestAad,
  versionField,
} from "../src/encoding/aad.ts";
import { kdfParamsDigest } from "../src/encoding/digest.ts";
import type { KdfParams } from "../src/types.ts";
import { loadJson } from "./helpers.ts";

interface AesSuite {
  constants: {
    vault_id: string;
    entry_id: string;
    device_id: string;
    crypto_version: number;
    schema_version: number;
    vault_key_version: number;
    device_key_version: number;
    revision: number;
    kdf: {
      algorithm: "argon2id";
      version: number;
      memory_kib: number;
      iterations: number;
      parallelism: number;
      hash_len: number;
      salt: string;
    };
    kdf_params_digest: string;
  };
  aad_construction: { hex: Record<string, string> };
}

interface DeviceSuite {
  constants: {
    vault_id: string;
    device_id: string;
    credential_id: string;
    crypto_version: number;
    device_key_version: number;
  };
  aad_construction: { hex: Record<string, string> };
}

const aes = loadJson<AesSuite>("aes-gcm-v1.json");
const device = loadJson<DeviceSuite>("device-prf-v1.json");
const C = aes.constants;
const hex = aes.aad_construction.hex;

const kdf: KdfParams = {
  algorithm: C.kdf.algorithm,
  version: C.kdf.version as 0x13,
  memory: C.kdf.memory_kib,
  iterations: C.kdf.iterations,
  parallelism: C.kdf.parallelism,
  hashLen: C.kdf.hash_len as 32,
  salt: hexToBytes(C.kdf.salt),
};

describe("canonical AAD", () => {
  it("encodes envelope master with the KDF parameter digest", () => {
    assert.equal(
      bytesToHex(
        envelopeAad({
          vaultId: C.vault_id,
          type: "master",
          cryptoVersion: C.crypto_version,
          vaultKeyVersion: C.vault_key_version,
          deviceId: "",
          deviceKeyVersion: 0,
          kdf,
        }),
      ),
      hex.envelope_master,
    );
  });

  it("encodes envelope device with deviceKeyVersion", () => {
    assert.equal(
      bytesToHex(
        envelopeAad({
          vaultId: C.vault_id,
          type: "device",
          cryptoVersion: C.crypto_version,
          vaultKeyVersion: C.vault_key_version,
          deviceId: C.device_id,
          deviceKeyVersion: C.device_key_version,
        }),
      ),
      hex.envelope_device,
    );
  });

  it("encodes envelope recovery", () => {
    assert.equal(
      bytesToHex(
        envelopeAad({
          vaultId: C.vault_id,
          type: "recovery",
          cryptoVersion: C.crypto_version,
          vaultKeyVersion: C.vault_key_version,
          deviceId: "",
          deviceKeyVersion: 0,
        }),
      ),
      hex.envelope_recovery,
    );
  });

  it("encodes entry with vaultKeyVersion", () => {
    assert.equal(
      bytesToHex(
        entryAad({
          vaultId: C.vault_id,
          entryId: C.entry_id,
          schemaVersion: C.schema_version,
          cryptoVersion: C.crypto_version,
          vaultKeyVersion: C.vault_key_version,
        }),
      ),
      hex.entry,
    );
  });

  it("encodes manifest AAD with revision", () => {
    assert.equal(
      bytesToHex(
        manifestAad({
          vaultId: C.vault_id,
          cryptoVersion: C.crypto_version,
          revision: C.revision,
          vaultKeyVersion: C.vault_key_version,
        }),
      ),
      hex.manifest,
    );
  });

  it("encodes the device-key AAD with deviceKeyVersion", () => {
    const D = device.constants;
    assert.equal(
      bytesToHex(
        deviceKeyAad({
          vaultId: D.vault_id,
          deviceId: D.device_id,
          credentialId: hexToBytes(D.credential_id),
          cryptoVersion: D.crypto_version,
          deviceKeyVersion: D.device_key_version,
        }),
      ),
      device.aad_construction.hex.device_key,
    );
  });

  it("matches the pinned KDF parameter digest", () => {
    assert.equal(bytesToHex(kdfParamsDigest(kdf)), C.kdf_params_digest);
  });

  it("rejects empty field list", () => {
    assert.throws(() => encodeAad([]), /at least one field/);
  });

  it("length-prefixes version as uint32be", () => {
    assert.equal(bytesToHex(versionField(1)), "00000001");
  });
});
