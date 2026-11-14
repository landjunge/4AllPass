import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  deriveWritePublicKey,
  deriveWriteSeed,
  encodeAad,
  versionField,
  writeSeedHkdfInfo,
  writeSeedHkdfSalt,
} from "../src/index.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const VK = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const VAULT = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";

describe("write-seed derivation (ADR-015)", () => {
  it("is deterministic and 32 bytes", () => {
    const a = deriveWriteSeed(VK, VAULT, 1);
    const b = deriveWriteSeed(VK, VAULT, 1);
    assert.equal(a.length, 32);
    assert.equal(hex(a), hex(b));
  });

  it("pins the exact HKDF construction (salt/info domain separation)", () => {
    const salt = sha256(encodeAad(["4allpass-write-seed-salt-v1", VAULT]));
    const info = encodeAad(["4allpass-write-seed-v1", VAULT, versionField(3)]);
    const expected = hkdf(sha256, VK, salt, info, 32);
    assert.equal(hex(deriveWriteSeed(VK, VAULT, 3)), hex(expected));
    assert.equal(hex(writeSeedHkdfSalt(VAULT)), hex(encodeAad(["4allpass-write-seed-salt-v1", VAULT])));
    assert.equal(hex(writeSeedHkdfInfo(VAULT, 3)), hex(info));
  });

  it("separates vault, key version and vault key", () => {
    const base = hex(deriveWriteSeed(VK, VAULT, 1));
    const otherVault = hex(deriveWriteSeed(VK, "11111111-2222-3333-4444-555555555555", 1));
    const rotated = hex(deriveWriteSeed(VK, VAULT, 2));
    const otherVk = hex(deriveWriteSeed(Uint8Array.from({ length: 32 }, () => 9), VAULT, 1));
    assert.notEqual(base, otherVault);
    assert.notEqual(base, rotated);
    assert.notEqual(base, otherVk);
  });

  it("rejects malformed inputs", () => {
    assert.throws(() => deriveWriteSeed(Uint8Array.from({ length: 31 }), VAULT, 1));
    assert.throws(() => deriveWriteSeed(VK, "", 1));
    assert.throws(() => deriveWriteSeed(VK, "x".repeat(257), 1));
    assert.throws(() => deriveWriteSeed(VK, VAULT, -1));
    assert.throws(() => deriveWriteSeed(VK, VAULT, 0x1_0000_0000));
  });

  it("derives the RFC 8032 Ed25519 public key from a 32-byte seed", async () => {
    const seed = Uint8Array.from(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
        .match(/.{2}/g)!
        .map((pair) => Number.parseInt(pair, 16)),
    );
    assert.equal(
      hex(await deriveWritePublicKey(seed)),
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    await assert.rejects(() => deriveWritePublicKey(new Uint8Array(31)));
  });
});
