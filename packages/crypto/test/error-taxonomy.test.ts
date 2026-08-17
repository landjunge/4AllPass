import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  decryptEntry,
  encryptEntry,
  generateVaultKey,
  randomBytes,
  unwrapVaultKey,
  wrapVaultKey,
} from "../src/index.ts";

const vaultId = "vault_taxonomy";

function deviceEnvelope() {
  const vaultKey = generateVaultKey();
  const deviceKey = randomBytes(32);
  const env = wrapVaultKey({
    vaultKey,
    wrappingKey: deviceKey,
    vaultId,
    type: "device",
    deviceId: "dev-1",
  });
  return { env, deviceKey };
}

describe("error taxonomy: malformed/tampered blobs are AuthFailureError (M3)", () => {
  it("wrong-length nonce on an envelope -> AuthFailureError", () => {
    const { env, deviceKey } = deviceEnvelope();
    assert.throws(
      () => unwrapVaultKey({ ...env, nonce: env.nonce.slice(0, 11) }, deviceKey, vaultId),
      AuthFailureError,
    );
  });

  it("wrong-length tag on an envelope -> AuthFailureError", () => {
    const { env, deviceKey } = deviceEnvelope();
    assert.throws(
      () => unwrapVaultKey({ ...env, tag: env.tag.slice(0, 15) }, deviceKey, vaultId),
      AuthFailureError,
    );
  });

  it("truncated ciphertext -> AuthFailureError", () => {
    const { env, deviceKey } = deviceEnvelope();
    assert.throws(
      () =>
        unwrapVaultKey(
          { ...env, ciphertext: env.ciphertext.slice(0, env.ciphertext.length - 1) },
          deviceKey,
          vaultId,
        ),
      AuthFailureError,
    );
  });

  it("extended ciphertext -> AuthFailureError", () => {
    const { env, deviceKey } = deviceEnvelope();
    const extended = new Uint8Array(env.ciphertext.length + 4);
    extended.set(env.ciphertext);
    assert.throws(
      () => unwrapVaultKey({ ...env, ciphertext: extended }, deviceKey, vaultId),
      AuthFailureError,
    );
  });

  it("entry with wrong-length tag -> AuthFailureError", () => {
    const vaultKey = generateVaultKey();
    const entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId: "e1",
      plaintext: new Uint8Array([1, 2, 3]),
    });
    assert.throws(
      () => decryptEntry({ ...entry, tag: entry.tag.slice(0, 15) }, vaultKey, vaultId),
      AuthFailureError,
    );
  });
});
