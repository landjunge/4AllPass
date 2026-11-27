import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { afterEach, test } from "node:test";
import { SignerUnavailableError } from "@4allpass/crypto";
import {
  createWriteSigner,
  isNativeRuntime,
  nativeWriteSigner,
  probeNativeSigner,
  setNativeInvokeForTests,
  type NativeInvoke,
} from "./write-signer.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Behaves like the native command: Ed25519 over the exact message, pubkey from the seed. */
const realNativeMock: NativeInvoke = async (command, args) => {
  assert.equal(command, "sign_ed25519_v2");
  const seed = Buffer.from(args.seed as number[]);
  const message = Buffer.from(args.message as number[]);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32);
  return { publicKey: Array.from(publicKey), signature: Array.from(nodeSign(null, message, key)) };
};

afterEach(() => setNativeInvokeForTests(null));

test("native runtime is detected via the test seam", () => {
  assert.equal(isNativeRuntime(), false);
  setNativeInvokeForTests(realNativeMock);
  assert.equal(isNativeRuntime(), true);
});

test("probeNativeSigner passes the exact canonical KAT", async () => {
  setNativeInvokeForTests(realNativeMock);
  const probe = await probeNativeSigner();
  assert.equal(probe.available, true, probe.reason);
});

test("probeNativeSigner fails closed on a wrong signature", async () => {
  setNativeInvokeForTests(async () => ({ publicKey: new Array(32).fill(0), signature: new Array(64).fill(0) }));
  const probe = await probeNativeSigner();
  assert.equal(probe.available, false);
});

test("probeNativeSigner fails closed when the command throws", async () => {
  setNativeInvokeForTests(async () => {
    throw new Error("write_preimage_invalid");
  });
  const probe = await probeNativeSigner();
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "native_signer_failed");
});

test("probeNativeSigner is unavailable outside the native runtime", async () => {
  const probe = await probeNativeSigner();
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "not_native_runtime");
});

test("nativeWriteSigner derives the public key from the same seed and signs", async () => {
  setNativeInvokeForTests(realNativeMock);
  const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
  const signer = await nativeWriteSigner(seed);
  assert.equal(Buffer.from(signer.publicKey).toString("hex"), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const message = Buffer.from("canonical preimage bytes");
  const signature = await signer.sign(message);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  assert.deepEqual(Buffer.from(signature), nodeSign(null, message, key));
});

test("createWriteSigner selects the native backend and rejects an invalid shape", async () => {
  setNativeInvokeForTests(realNativeMock);
  const signer = await createWriteSigner(Buffer.alloc(32, 7));
  assert.equal(signer.publicKey.length, 32);
  setNativeInvokeForTests(async () => ({ nope: true }));
  await assert.rejects(() => createWriteSigner(Buffer.alloc(32, 7)), SignerUnavailableError);
});

test("browser WebCrypto signer imports its non-extractable key before clearing PKCS#8 bytes", async () => {
  const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
  const signer = await createWriteSigner(seed);
  assert.equal(
    Buffer.from(signer.publicKey).toString("hex"),
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  );

  const message = new TextEncoder().encode("browser canonical preimage");
  const signature = Buffer.from(await signer.sign(message));
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  assert.equal(nodeVerify(null, message, publicKey, signature), true);
});
