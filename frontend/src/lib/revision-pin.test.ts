import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bytesToBase64 } from "@4allpass/crypto";
import { loadPin, savePin } from "./revision-pin.ts";

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  },
});

afterEach(() => {
  store.clear();
});

describe("revision pin", () => {
  it("round-trips a verified manifest digest", () => {
    const digest = new Uint8Array(32).map((_, index) => index + 1);
    savePin({
      vaultId: "vault-1",
      revision: 4,
      vaultKeyVersion: 2,
      cryptoProtocolVersion: 1,
      manifestDigest: digest,
    });
    const loaded = loadPin("vault-1");
    assert.equal(loaded?.revision, 4);
    assert.equal(loaded?.vaultKeyVersion, 2);
    assert.deepEqual(loaded?.manifestDigest, digest);
    assert.match(store.get("4allpass.pin.vault-1") ?? "", new RegExp(bytesToBase64(digest)));
  });

  it("ignores pins for a different vault", () => {
    savePin({
      vaultId: "vault-1",
      revision: 1,
      vaultKeyVersion: 1,
      cryptoProtocolVersion: 1,
    });
    assert.equal(loadPin("vault-2"), null);
  });
});
