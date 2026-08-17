import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARGON2_VERSION, HASH_LEN } from "../src/constants.ts";
import { deriveMasterKey } from "../src/kdf/argon2id.ts";
import { deriveArgon2idRaw } from "../src/test-only.ts";
import { decrypt } from "../src/aead/aes-gcm.ts";
import { AuthFailureError } from "../src/errors.ts";
import { bytesToHex } from "../src/encoding/bytes.ts";
import { hex, loadJson, skipHeavy, type Argon2Vector } from "./helpers.ts";

interface WrapVector {
  id: string;
  expect: "decrypt_ok" | "auth_fail";
  key: string;
  nonce: string;
  aad: string;
  plaintext?: string;
  ciphertext: string;
  tag: string;
}

interface Suite {
  rfc9106: Argon2Vector[];
  success: Argon2Vector[];
  negative: Argon2Vector[];
  wrap: WrapVector[];
}

const suite = loadJson<Suite>("argon2id-v1.json");

function derive(v: Argon2Vector): Uint8Array {
  return deriveArgon2idRaw({
    password: hex(v.password),
    salt: hex(v.salt),
    params: {
      memory: v.memory_kib,
      iterations: v.iterations,
      parallelism: v.parallelism,
      hashLen: HASH_LEN,
      version: (v.version ?? ARGON2_VERSION) as 0x13,
    },
    ...(v.secret ? { secret: hex(v.secret) } : {}),
    ...(v.associated_data ? { associatedData: hex(v.associated_data) } : {}),
  });
}

describe("Argon2id RFC 9106", () => {
  for (const v of suite.rfc9106) {
    it(v.id, () => {
      assert.equal(bytesToHex(derive(v)), v.dk);
    });
  }
});

describe("Argon2id protocol success", () => {
  for (const v of suite.success) {
    it(v.id, { skip: skipHeavy(v.memory_kib) }, () => {
      assert.equal(bytesToHex(derive(v)), v.dk);
    });
  }
});

describe("Argon2id negative", () => {
  const ci = suite.success.find((v) => v.id === "TV-ARGON2-CI");
  assert.ok(ci);
  for (const v of suite.negative) {
    it(v.id, () => {
      const got = derive(v);
      assert.equal(bytesToHex(got), v.dk);
      assert.notEqual(bytesToHex(got), ci.dk);
    });
  }
});

describe("Argon2id NFC password path", () => {
  it("deriveMasterKey matches TV-ARGON2-UNICODE", () => {
    const v = suite.success.find((x) => x.id === "TV-ARGON2-UNICODE");
    assert.ok(v);
    const mk = deriveMasterKey("paßwort-🔑", hex(v.salt), {
      algorithm: "argon2id",
      version: 0x13,
      memory: v.memory_kib,
      iterations: v.iterations,
      parallelism: v.parallelism,
      hashLen: 32,
    });
    assert.equal(bytesToHex(mk), v.dk);
  });
});

describe("Argon2id wrap", () => {
  for (const v of suite.wrap) {
    it(v.id, () => {
      if (v.expect === "decrypt_ok") {
        const pt = decrypt(hex(v.key), hex(v.nonce), hex(v.ciphertext), hex(v.tag), hex(v.aad));
        assert.equal(bytesToHex(pt), v.plaintext ?? "");
      } else {
        assert.throws(
          () => decrypt(hex(v.key), hex(v.nonce), hex(v.ciphertext), hex(v.tag), hex(v.aad)),
          AuthFailureError,
        );
      }
    });
  }
});
