import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decrypt } from "../src/aead/aes-gcm.ts";
import { encryptWithNonce } from "../src/test-only.ts";
import { AuthFailureError } from "../src/errors.ts";
import { bytesToHex } from "../src/encoding/bytes.ts";
import { hex, loadJson, type GcmVector } from "./helpers.ts";

interface Suite {
  success: GcmVector[];
  tamper: GcmVector[];
  nist: GcmVector[];
}

const suite = loadJson<Suite>("aes-gcm-v1.json");

function checkDecryptOk(v: GcmVector): void {
  const pt = decrypt(hex(v.key), hex(v.nonce), hex(v.ciphertext), hex(v.tag), hex(v.aad));
  assert.equal(bytesToHex(pt), v.plaintext ?? "");
  const box = encryptWithNonce(hex(v.key), hex(v.nonce), hex(v.plaintext ?? ""), hex(v.aad));
  assert.equal(bytesToHex(box.ciphertext), v.ciphertext);
  assert.equal(bytesToHex(box.tag), v.tag);
}

function checkAuthFail(v: GcmVector): void {
  assert.throws(
    () => decrypt(hex(v.key), hex(v.nonce), hex(v.ciphertext), hex(v.tag), hex(v.aad)),
    AuthFailureError,
  );
}

describe("AES-256-GCM NIST", () => {
  for (const v of suite.nist) {
    it(v.id, () => checkDecryptOk(v));
  }
});

describe("AES-256-GCM protocol success", () => {
  for (const v of suite.success) {
    it(v.id, () => checkDecryptOk(v));
  }
});

describe("AES-256-GCM tamper", () => {
  for (const v of suite.tamper) {
    it(v.id, () => checkAuthFail(v));
  }
});
