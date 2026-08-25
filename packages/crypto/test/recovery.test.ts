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
  wrapRecoveryEnvelope,
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

  it("round-trips 1000 random keys and always produces the same shape", () => {
    for (let i = 0; i < 1000; i++) {
      const key = generateRecoveryKey();
      const formatted = formatRecoveryKey(key);
      assert.match(formatted, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){10}$/);
      assert.deepEqual(parseRecoveryKey(formatted), key);
    }
  });

  it("covers every alphabet symbol without ambiguity", () => {
    const alphabet = suite.encoding.alphabet;
    assert.equal(alphabet.length, 32);
    assert.equal(new Set(alphabet).size, 32);
    for (const forbidden of ["I", "L", "O", "U"]) {
      assert.equal(alphabet.includes(forbidden), false);
    }
    const seen = new Set<string>();
    for (let i = 0; i < 2000 && seen.size < 32; i++) {
      for (const char of formatRecoveryKey(generateRecoveryKey()).replace(/-/g, "")) {
        seen.add(char);
      }
    }
    assert.equal(seen.size, 32, `unreachable symbols: ${[...alphabet].filter((c) => !seen.has(c)).join("")}`);
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

describe("recovery wrap reasons", () => {
  it("create wraps under the current vault key generation", () => {
    const envelope = wrapRecoveryEnvelope({
      reason: "create",
      vaultKey: hexToBytes(C.vault_key),
      recoveryKey,
      vaultId: C.vault_id,
      vaultKeyVersion: 1,
    });
    assert.equal(envelope.type, "recovery");
    assert.equal(envelope.vaultKeyVersion, 1);
  });

  it("trusted replacement keeps vaultKeyVersion and refuses the same printed key", () => {
    const next = generateRecoveryKey();
    const envelope = wrapRecoveryEnvelope({
      reason: "trusted_replacement",
      vaultKey: hexToBytes(C.vault_key),
      recoveryKey: next,
      vaultId: C.vault_id,
      vaultKeyVersion: 1,
      previousVaultKeyVersion: 1,
      previousRecoveryKey: recoveryKey,
    });
    assert.equal(envelope.vaultKeyVersion, 1);
    assert.throws(
      () =>
        wrapRecoveryEnvelope({
          reason: "trusted_replacement",
          vaultKey: hexToBytes(C.vault_key),
          recoveryKey,
          vaultId: C.vault_id,
          vaultKeyVersion: 1,
          previousVaultKeyVersion: 1,
          previousRecoveryKey: recoveryKey,
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        wrapRecoveryEnvelope({
          reason: "trusted_replacement",
          vaultKey: hexToBytes(C.vault_key),
          recoveryKey: next,
          vaultId: C.vault_id,
          vaultKeyVersion: 2,
          previousVaultKeyVersion: 1,
          previousRecoveryKey: recoveryKey,
        }),
      ProtocolError,
    );
  });

  it("compromised rotation must increment vaultKeyVersion and mint a new key", () => {
    const next = generateRecoveryKey();
    const vk2 = generateRecoveryKey();
    const envelope = wrapRecoveryEnvelope({
      reason: "compromised_rotation",
      vaultKey: vk2,
      recoveryKey: next,
      vaultId: C.vault_id,
      vaultKeyVersion: 2,
      previousVaultKeyVersion: 1,
      previousRecoveryKey: recoveryKey,
    });
    assert.equal(envelope.vaultKeyVersion, 2);
    assert.throws(
      () =>
        wrapRecoveryEnvelope({
          reason: "compromised_rotation",
          vaultKey: vk2,
          recoveryKey: next,
          vaultId: C.vault_id,
          vaultKeyVersion: 1,
          previousVaultKeyVersion: 1,
          previousRecoveryKey: recoveryKey,
        }),
      /must increment vaultKeyVersion/,
    );
    assert.throws(
      () =>
        wrapRecoveryEnvelope({
          reason: "compromised_rotation",
          vaultKey: vk2,
          recoveryKey,
          vaultId: C.vault_id,
          vaultKeyVersion: 2,
          previousVaultKeyVersion: 1,
          previousRecoveryKey: recoveryKey,
        }),
      /must mint a new recovery key/,
    );
  });
});
