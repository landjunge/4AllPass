#!/usr/bin/env node
/**
 * Verify docs/test-vectors/aes-gcm-v1.json against node:crypto AES-256-GCM.
 *
 * Usage (from repo root):
 *   node scripts/verify-aes-gcm-vectors.mjs
 */
import { createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "docs/test-vectors/aes-gcm-v1.json");
const suite = JSON.parse(readFileSync(path, "utf8"));
const fromHex = (h) => Buffer.from(h || "", "hex");

function encrypt(key, nonce, plaintext, aad) {
  const c = createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(aad);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext, tag: c.getAuthTag() };
}

function decrypt(key, nonce, ciphertext, tag, aad) {
  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

let failed = 0;
function ok(id, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${id}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${id}${detail ? " — " + detail : ""}`);
  }
}

function checkSuccess(v) {
  const key = fromHex(v.key);
  const nonce = fromHex(v.nonce);
  const aad = fromHex(v.aad);
  const pt = fromHex(v.plaintext);
  try {
    const got = encrypt(key, nonce, pt, aad);
    const ctMatch = got.ciphertext.equals(fromHex(v.ciphertext));
    const tagMatch = got.tag.equals(fromHex(v.tag));
    const round = decrypt(key, nonce, got.ciphertext, got.tag, aad);
    ok(v.id, ctMatch && tagMatch && round.equals(pt), `ct=${ctMatch} tag=${tagMatch}`);
  } catch (e) {
    ok(v.id, false, e.message);
  }
}

function checkTamper(v) {
  try {
    decrypt(fromHex(v.key), fromHex(v.nonce), fromHex(v.ciphertext), fromHex(v.tag), fromHex(v.aad));
    ok(v.id, false, "decrypt unexpectedly succeeded");
  } catch {
    ok(v.id, true);
  }
}

console.log("NIST interop");
for (const v of suite.nist) checkSuccess(v);
console.log("Protocol success");
for (const v of suite.success) checkSuccess(v);
console.log("Tamper (must fail auth)");
for (const v of suite.tamper) checkTamper(v);

if (failed) {
  console.error(`\n${failed} vector(s) failed`);
  process.exit(1);
}
console.log("\nAll AES-GCM v1 vectors passed.");
