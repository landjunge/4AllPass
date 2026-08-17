import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  ProtocolError,
  bytesToHex,
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  generateRecoveryKey,
  generateVaultKey,
  hexToBytes,
  parseRecoveryKey,
  unwrapRecoveryEnvelope,
  unwrapVaultKey,
  wrapRecoveryEnvelope,
} from "../src/index.ts";
import { wrapRecoveryEnvelopeWithNonce } from "../src/test-only.ts";
import { loadJson } from "./helpers.ts";

interface Suite {
  constants: {
    vault_id: string;
    recovery_key: string;
    vault_key: string;
  };
  success: Array<Record<string, string>>;
}

const suite = loadJson<Suite>("recovery-v1.json");
const C = suite.constants;
const rk = hexToBytes(C.recovery_key);
const vk = hexToBytes(C.vault_key);

function find(id: string): Record<string, string> {
  const v = suite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

describe("recovery key", () => {
  it("TV-RECOVERY-ENCODE formats and parses the Emergency Kit string", () => {
    const v = find("TV-RECOVERY-ENCODE");
    const encoded = v.encoded ?? "";
    assert.equal(formatRecoveryKey(rk), encoded);
    assert.deepEqual(parseRecoveryKey(encoded), rk);
    assert.deepEqual(parseRecoveryKey(encoded.toUpperCase().replaceAll(".", " - ")), rk);
  });

  it("TV-RECOVERY-RWK derives a vault-bound wrapping key", () => {
    const v = find("TV-RECOVERY-RWK");
    const rwk = deriveRecoveryWrappingKey({ recoveryKey: rk, vaultId: C.vault_id });
    assert.equal(bytesToHex(rwk), v.recovery_wrapping_key);
    const other = deriveRecoveryWrappingKey({ recoveryKey: rk, vaultId: "vault_OTHER" });
    assert.notEqual(bytesToHex(other), v.recovery_wrapping_key);
  });

  it("TV-RECOVERY-WRAP unwraps VK", () => {
    const v = find("TV-RECOVERY-WRAP");
    const env = wrapRecoveryEnvelopeWithNonce({
      vaultKey: vk,
      recoveryKey: rk,
      vaultId: C.vault_id,
      nonce: hexToBytes(v.nonce ?? ""),
    });
    assert.equal(bytesToHex(env.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(env.tag), v.tag);
    assert.deepEqual(unwrapRecoveryEnvelope(env, rk, C.vault_id), vk);
  });

  it("rejects a checksum typo", () => {
    const encoded = formatRecoveryKey(rk);
    const broken = `${encoded.slice(0, -1)}${encoded.endsWith("0") ? "1" : "0"}`;
    assert.throws(() => parseRecoveryKey(broken), ProtocolError);
  });

  it("rejects the raw recovery key as a wrapping key (HKDF is mandatory)", () => {
    const env = wrapRecoveryEnvelope({
      vaultKey: vk,
      recoveryKey: rk,
      vaultId: C.vault_id,
    });
    assert.throws(() => unwrapVaultKey(env, rk, C.vault_id), AuthFailureError);
  });

  it("round-trips a freshly generated key", () => {
    const key = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const env = wrapRecoveryEnvelope({
      vaultKey,
      recoveryKey: key,
      vaultId: C.vault_id,
    });
    assert.deepEqual(unwrapRecoveryEnvelope(env, parseRecoveryKey(formatRecoveryKey(key)), C.vault_id), vaultKey);
  });
});
