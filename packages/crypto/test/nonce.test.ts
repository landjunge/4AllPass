import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encrypt } from "../src/aead/aes-gcm.ts";
import { bytesToHex, generateVaultKey } from "../src/index.ts";

describe("nonce ownership", () => {
  it("public encrypt does not accept a nonce argument", () => {
    assert.equal(encrypt.length, 3);
  });

  it("issues unique nonces across 64 encryptions", () => {
    const key = generateVaultKey();
    const aad = new Uint8Array(0);
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const box = encrypt(key, new Uint8Array([i]), aad);
      const h = bytesToHex(box.nonce);
      assert.equal(seen.has(h), false);
      seen.add(h);
    }
  });
});
