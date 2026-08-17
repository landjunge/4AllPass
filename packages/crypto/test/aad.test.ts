import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bytesToHex } from "../src/encoding/bytes.ts";
import { encodeAad, envelopeAad, entryAad, versionField } from "../src/encoding/aad.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: { vault_id: string; entry_id: string; device_id: string };
  aad_construction: { hex: Record<string, string> };
}

const suite = loadJson<Suite>("aes-gcm-v1.json");
const { vault_id, entry_id, device_id } = suite.constants;
const hex = suite.aad_construction.hex;

describe("canonical AAD", () => {
  it("encodes envelope master", () => {
    assert.equal(bytesToHex(envelopeAad(vault_id, "master", "", 1)), hex.envelope_master);
  });

  it("encodes envelope device", () => {
    assert.equal(bytesToHex(envelopeAad(vault_id, "device", device_id, 1)), hex.envelope_device);
  });

  it("encodes envelope recovery", () => {
    assert.equal(bytesToHex(envelopeAad(vault_id, "recovery", "", 1)), hex.envelope_recovery);
  });

  it("encodes entry", () => {
    assert.equal(bytesToHex(entryAad(vault_id, entry_id, 1, 1)), hex.entry);
  });

  it("rejects empty field list", () => {
    assert.throws(() => encodeAad([]), /at least one field/);
  });

  it("length-prefixes version as uint32be", () => {
    assert.equal(bytesToHex(versionField(1)), "00000001");
  });
});
