import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IntegrityError,
  ProtocolError,
  bytesToHex,
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  generateRecoveryKey,
  hexToBytes,
  parseRecoveryKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "../src/index.ts";
import { wrapVaultKeyWithNonce } from "../src/test-only.ts";
import { loadJson, type RecoverySuite } from "./helpers.ts";

const suite = loadJson<RecoverySuite>("recovery-v1.json");
const C = suite.constants;
const recoveryKey = hexToBytes(C.recovery_key);

function req(v: Record<string, string> | undefined, key: string): string {
  assert.ok(v, "vector");
  const value = v[key];
  assert.ok(value, key);
  return value;
}

function success(id: string): Record<string, string> {
  const v = suite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

describe("recovery key representation", () => {
  it("TV-RK-FORMAT: formats the Emergency Kit string", () => {
    const v = success("TV-RK-FORMAT");
    assert.equal(formatRecoveryKey(recoveryKey), req(v, "formatted"));
  });

  it("round-trips through format / parse", () => {
    const key = generateRecoveryKey();
    assert.deepEqual(parseRecoveryKey(formatRecoveryKey(key)), key);
  });

  it("accepts sloppy user input (case, spacing, Crockford substitutions)", () => {
    const formatted = formatRecoveryKey(recoveryKey);
    const sloppy = formatted.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    assert.deepEqual(parseRecoveryKey(sloppy), recoveryKey);
  });

  it("TV-RK-CHECKSUM: reports a mistyped character as a checksum failure", () => {
    const v = suite.negative.find((x) => x.id === "TV-RK-CHECKSUM");
    assert.throws(() => parseRecoveryKey(req(v, "formatted")), IntegrityError);
  });

  it("TV-RK-NONCANONICAL: refuses non-zero padding bits", () => {
    const v = suite.negative.find((x) => x.id === "TV-RK-NONCANONICAL");
    assert.throws(() => parseRecoveryKey(req(v, "formatted")), ProtocolError);
  });

  it("rejects a truncated kit string", () => {
    const formatted = formatRecoveryKey(recoveryKey);
    assert.throws(() => parseRecoveryKey(formatted.slice(0, 20)), ProtocolError);
  });

  it("rejects characters outside the alphabet", () => {
    const formatted = formatRecoveryKey(recoveryKey);
    assert.throws(() => parseRecoveryKey(`${formatted.slice(0, -1)}U`), ProtocolError);
  });

  it("refuses an all-zero recovery key", () => {
    assert.throws(() => formatRecoveryKey(new Uint8Array(32)), ProtocolError);
    assert.throws(
      () => deriveRecoveryWrappingKey({ recoveryKey: new Uint8Array(32), vaultId: C.vault_id }),
      ProtocolError,
    );
  });
});

describe("recovery wrapping key", () => {
  it("TV-RWK-01: derives the pinned RWK", () => {
    const v = success("TV-RWK-01");
    const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId: C.vault_id });
    assert.equal(bytesToHex(rwk), req(v, "recovery_wrapping_key"));
  });

  it("TV-RWK-WRONG-VAULT: is bound to the vault", () => {
    const expected = req(success("TV-RWK-01"), "recovery_wrapping_key");
    const other = deriveRecoveryWrappingKey({ recoveryKey, vaultId: "vault_OTHER" });
    assert.notEqual(bytesToHex(other), expected);
  });

  it("TV-ENV-RECOVERY-RWK: wraps the vault key under the RWK, not the printed key", () => {
    const v = success("TV-ENV-RECOVERY-RWK");
    const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId: C.vault_id });
    const envelope = wrapVaultKeyWithNonce({
      vaultKey: hexToBytes(C.vault_key),
      wrappingKey: rwk,
      vaultId: C.vault_id,
      type: "recovery",
      vaultKeyVersion: C.vault_key_version,
      nonce: hexToBytes(req(v, "nonce")),
    });
    assert.equal(bytesToHex(envelope.ciphertext), req(v, "ciphertext"));
    assert.equal(bytesToHex(envelope.tag), req(v, "tag"));
    assert.deepEqual(
      unwrapVaultKey(envelope, {
        wrappingKey: rwk,
        vaultId: C.vault_id,
        expectType: "recovery",
        expectVaultKeyVersion: C.vault_key_version,
      }),
      hexToBytes(C.vault_key),
    );
  });

  it("the printed recovery key alone does not open the envelope", () => {
    const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId: C.vault_id });
    const envelope = wrapVaultKey({
      vaultKey: hexToBytes(C.vault_key),
      wrappingKey: rwk,
      vaultId: C.vault_id,
      type: "recovery",
      vaultKeyVersion: C.vault_key_version,
    });
    assert.throws(() =>
      unwrapVaultKey(envelope, {
        wrappingKey: recoveryKey,
        vaultId: C.vault_id,
        expectType: "recovery",
        expectVaultKeyVersion: C.vault_key_version,
      }),
    );
  });
});
