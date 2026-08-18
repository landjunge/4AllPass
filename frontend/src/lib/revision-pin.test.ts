import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bytesToHex } from "@4allpass/crypto";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  },
});

const { loadPin, savePin } = await import("./revision-pin.ts");

const VAULT_ID = "vault_pin_test";

afterEach(() => {
  store.clear();
});

describe("revision pin", () => {
  it("round-trips a verified manifest digest and omits it when absent", () => {
    const digest = new Uint8Array(32).fill(7);
    savePin({
      vaultId: VAULT_ID,
      revision: 4,
      vaultKeyVersion: 2,
      cryptoProtocolVersion: 1,
      manifestDigest: digest,
    });
    const loaded = loadPin(VAULT_ID);
    assert.equal(loaded?.revision, 4);
    assert.equal(loaded?.vaultKeyVersion, 2);
    assert.equal(loaded && loaded.manifestDigest && bytesToHex(loaded.manifestDigest), bytesToHex(digest));

    savePin({
      vaultId: VAULT_ID,
      revision: 5,
      vaultKeyVersion: 2,
      cryptoProtocolVersion: 1,
    });
    const without = loadPin(VAULT_ID);
    assert.equal(without?.revision, 5);
    assert.equal(without?.manifestDigest, undefined);
  });
});
