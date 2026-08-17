import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesToHex,
  hexToBytes,
  selectDeviceUnlock,
  unwrapDeviceKeyFromPrf,
  wrapDeviceKeyFromPrf,
} from "../src/index.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: {
    vault_id: string;
    device_id: string;
    rp_id: string;
    credential_id: string;
    prf_output: string;
    device_key: string;
  };
}

const suite = loadJson<Suite>("device-prf-v1.json");
const C = suite.constants;
const cred = hexToBytes(C.credential_id);
const deviceKey = hexToBytes(C.device_key);

describe("PRF wrap/unwrap zeroizes ephemeral material", () => {
  it("round-trips DK and clears the caller PRF buffer", () => {
    const prfWrap = hexToBytes(C.prf_output);
    const envelope = wrapDeviceKeyFromPrf({
      prfOutput: prfWrap,
      rpId: C.rp_id,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: cred,
      deviceKey,
    });
    assert.ok(prfWrap.every((b) => b === 0), "PRF output must be zeroized after wrap");

    const prfUnwrap = hexToBytes(C.prf_output);
    const unwrapped = unwrapDeviceKeyFromPrf({
      prfOutput: prfUnwrap,
      rpId: C.rp_id,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: cred,
      envelope,
    });
    assert.equal(bytesToHex(unwrapped), C.device_key);
    assert.ok(prfUnwrap.every((b) => b === 0), "PRF output must be zeroized after unwrap");
  });
});

describe("device unlock fallback rank", () => {
  it("prefers PRF over largeBlob over UV-gated local store", () => {
    assert.equal(
      selectDeviceUnlock(["uv_gated_local", "prf", "large_blob"]),
      "prf",
    );
    assert.equal(selectDeviceUnlock(["uv_gated_local", "large_blob"]), "large_blob");
    assert.equal(selectDeviceUnlock(["uv_gated_local"]), "uv_gated_local");
    assert.equal(selectDeviceUnlock([]), undefined);
  });
});
