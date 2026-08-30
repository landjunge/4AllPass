import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  enrollRequester,
  requesterIdFromPublicKey,
  requesterRequestBytes,
  rotateRequester,
  verifyRequesterSignature,
  deriveDeviceWrappingKey,
  generateDeviceKey,
  generateVaultKey,
} from "../src/index.ts";
import { C } from "./fixtures.ts";

function generatePair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("missing jwk.x");
  const raw = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  return { privateKey, publicKey: raw, enrollment: enrollRequester(raw) };
}

function signWith(privateKey: KeyObject, message: Uint8Array): Uint8Array {
  return new Uint8Array(nodeSign(null, message, privateKey));
}

describe("requester identity is not a vault device", () => {
  it("enrolls a public key and verifies a signed request", async () => {
    const { privateKey, publicKey, enrollment } = generatePair();
    const message = requesterRequestBytes({
      requesterId: enrollment.requesterId,
      nonce: "n1",
      timestamp: 1_700_000_000,
      action: "credential.use",
      resource: "github",
    });
    const signature = signWith(privateKey, message);
    await verifyRequesterSignature({
      publicKey,
      signature,
      message,
      expectedRequesterId: enrollment.requesterId,
    });
    assert.match(enrollment.requesterId, /^req:ed25519:[0-9a-f]{64}$/);
    assert.equal(requesterIdFromPublicKey(publicKey), enrollment.requesterId);
  });

  it("rejects a missing or truncated signature", async () => {
    const { publicKey, enrollment } = generatePair();
    const message = requesterRequestBytes({
      requesterId: enrollment.requesterId,
      nonce: "n2",
      timestamp: 1,
      action: "credential.use",
      resource: "github",
    });
    await assert.rejects(
      () =>
        verifyRequesterSignature({
          publicKey,
          signature: new Uint8Array(0),
          message,
          expectedRequesterId: enrollment.requesterId,
        }),
      ProtocolError,
    );
    await assert.rejects(
      () =>
        verifyRequesterSignature({
          publicKey,
          signature: new Uint8Array(63),
          message,
          expectedRequesterId: enrollment.requesterId,
        }),
      ProtocolError,
    );
  });

  it("rejects a signature from a different key", async () => {
    const a = generatePair();
    const b = generatePair();
    const message = requesterRequestBytes({
      requesterId: a.enrollment.requesterId,
      nonce: "n3",
      timestamp: 2,
      action: "credential.use",
      resource: "github",
    });
    const signature = signWith(b.privateKey, message);
    await assert.rejects(
      () =>
        verifyRequesterSignature({
          publicKey: a.publicKey,
          signature,
          message,
          expectedRequesterId: a.enrollment.requesterId,
        }),
      AuthFailureError,
    );
  });

  it("rejects a public key that does not match the expected requester id", async () => {
    const a = generatePair();
    const b = generatePair();
    const message = requesterRequestBytes({
      requesterId: a.enrollment.requesterId,
      nonce: "n4",
      timestamp: 3,
      action: "credential.use",
      resource: "github",
    });
    const signature = signWith(b.privateKey, message);
    await assert.rejects(
      () =>
        verifyRequesterSignature({
          publicKey: b.publicKey,
          signature,
          message,
          expectedRequesterId: a.enrollment.requesterId,
        }),
      IntegrityError,
    );
  });

  it("rotation issues a new id; the old key cannot authenticate as the new one", async () => {
    const old = generatePair();
    const next = generatePair();
    const rotated = rotateRequester(next.publicKey);
    assert.notEqual(rotated.requesterId, old.enrollment.requesterId);
    const message = requesterRequestBytes({
      requesterId: rotated.requesterId,
      nonce: "n5",
      timestamp: 4,
      action: "credential.use",
      resource: "github",
    });
    const oldSig = signWith(old.privateKey, message);
    await assert.rejects(
      () =>
        verifyRequesterSignature({
          publicKey: old.publicKey,
          signature: oldSig,
          message,
          expectedRequesterId: rotated.requesterId,
        }),
      IntegrityError,
    );
    const newSig = signWith(next.privateKey, message);
    await verifyRequesterSignature({
      publicKey: next.publicKey,
      signature: newSig,
      message,
      expectedRequesterId: rotated.requesterId,
    });
  });

  it("does not wrap or unwrap a Vault Key", async () => {
    const { publicKey } = generatePair();
    const enrollment = enrollRequester(publicKey);
    assert.ok(!("ciphertext" in enrollment));
    assert.ok(!("nonce" in enrollment));
    assert.notEqual(enrollment.requesterId, C.device_id);
    generateVaultKey();
    generateDeviceKey();
    deriveDeviceWrappingKey({
      prfOutput: new Uint8Array(32).fill(7),
      rpId: "localhost",
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: new Uint8Array(16).fill(0xa1),
    });
  });
});
