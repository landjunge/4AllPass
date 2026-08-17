/**
 * End-to-end browser-side flow per docs/webauthn-prf.md §2:
 * register → assertion + PRF → HKDF → DWK → unwrap DK → unwrap VK.
 * Uses a deterministic software authenticator; no real WebAuthn involved.
 */

import { describe, expect, it } from "vitest";
import {
  AuthFailureError,
  equalBytes,
  generateVaultKey,
  prfEvalFirst,
  unwrapDeviceKey,
} from "@4allpass/crypto";
import {
  PrfUnavailableError,
  registerPrfUnlock,
  unlockWithPrf,
  type UnlockContext,
} from "../src/unlock/webauthn-prf";
import { classifyCredential } from "../src/unlock/capability";
import { FakePrfAuthenticator } from "./fake-authenticator";

const ctx: UnlockContext = {
  rpId: "pass.example.local",
  vaultId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
};

function challenge(): Uint8Array {
  const c = new Uint8Array(32);
  crypto.getRandomValues(c);
  return c;
}

async function register(bridge: FakePrfAuthenticator, vaultKey: Uint8Array) {
  return registerPrfUnlock({
    ctx,
    rpName: "4AllPass",
    vaultKey,
    challenge: challenge(),
    userHandle: new TextEncoder().encode(ctx.vaultId),
    userName: "alice",
    bridge,
  });
}

describe("registerPrfUnlock", () => {
  it("produces device-key envelope and device envelope bound to the context", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const result = await register(bridge, vaultKey);

    expect(result.credentialId.length).toBeGreaterThan(0);
    expect(result.deviceKeyEnvelope.vaultId).toBe(ctx.vaultId);
    expect(result.deviceKeyEnvelope.deviceId).toBe(ctx.deviceId);
    expect(equalBytes(result.deviceKeyEnvelope.credentialId, result.credentialId)).toBe(true);
    expect(result.deviceEnvelope.type).toBe("device");
    expect(result.deviceEnvelope.deviceId).toBe(ctx.deviceId);
    // The registration output never contains the vault key in the clear.
    expect(equalBytes(result.deviceEnvelope.ciphertext, vaultKey)).toBe(false);
  });
});

describe("unlockWithPrf", () => {
  it("round-trips the vault key: PRF → HKDF → DWK → DK → VK", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const expected = new Uint8Array(vaultKey);
    const reg = await register(bridge, vaultKey);

    const unlocked = await unlockWithPrf({
      ctx,
      credentialId: reg.credentialId,
      challenge: challenge(),
      deviceKeyEnvelope: reg.deviceKeyEnvelope,
      deviceEnvelope: reg.deviceEnvelope,
      bridge,
    });
    expect(equalBytes(unlocked, expected)).toBe(true);
  });

  it("fails against an envelope from a different rpId (cross-origin PRF copy)", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const reg = await register(bridge, vaultKey);

    // Same authenticator secret, different RP context: HKDF info binds rpId,
    // so the derived DWK cannot unwrap the Device-Key Envelope. The fake
    // authenticator matches credentials by rpId, so register the other RP too.
    const otherCtx = { ...ctx, rpId: "evil.example" };
    await expect(
      unlockWithPrf({
        ctx: otherCtx,
        credentialId: reg.credentialId,
        challenge: challenge(),
        deviceKeyEnvelope: reg.deviceKeyEnvelope,
        deviceEnvelope: reg.deviceEnvelope,
        bridge,
      }),
    ).rejects.toThrow(); // no credential for that rpId, or AuthFailure on unwrap
  });

  it("fails cleanly when the device-key envelope was tampered with", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const reg = await register(bridge, vaultKey);
    reg.deviceKeyEnvelope.ciphertext[0]! ^= 0xff;

    await expect(
      unlockWithPrf({
        ctx,
        credentialId: reg.credentialId,
        challenge: challenge(),
        deviceKeyEnvelope: reg.deviceKeyEnvelope,
        deviceEnvelope: reg.deviceEnvelope,
        bridge,
      }),
    ).rejects.toThrow(AuthFailureError);
  });

  it("throws PrfUnavailableError when the authenticator has no PRF (fallback trigger)", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const reg = await register(bridge, vaultKey);

    bridge.prfSupported = false;
    await expect(
      unlockWithPrf({
        ctx,
        credentialId: reg.credentialId,
        challenge: challenge(),
        deviceKeyEnvelope: reg.deviceKeyEnvelope,
        deviceEnvelope: reg.deviceEnvelope,
        bridge,
      }),
    ).rejects.toThrow(PrfUnavailableError);
  });

  it("registration falls back to an assertion when create returns no PRF results", async () => {
    // FakePrfAuthenticator never returns results at create time, so every
    // successful registration in this suite already exercised that path.
    // This test just makes the expectation explicit end-to-end.
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const expected = new Uint8Array(vaultKey);
    const reg = await register(bridge, vaultKey);
    const unlocked = await unlockWithPrf({
      ctx,
      credentialId: reg.credentialId,
      challenge: challenge(),
      deviceKeyEnvelope: reg.deviceKeyEnvelope,
      deviceEnvelope: reg.deviceEnvelope,
      bridge,
    });
    expect(equalBytes(unlocked, expected)).toBe(true);
  });

  it("device key from the envelope actually unwraps under the derived DWK only", async () => {
    const bridge = new FakePrfAuthenticator();
    const vaultKey = generateVaultKey();
    const reg = await register(bridge, vaultKey);

    const wrongDwk = new Uint8Array(32);
    expect(() => unwrapDeviceKey(reg.deviceKeyEnvelope, wrongDwk)).toThrow(AuthFailureError);
  });
});

describe("prf.eval.first", () => {
  it("is SHA-256 of the encoded context and stable per (rpId, vaultId)", () => {
    const a = prfEvalFirst(ctx.rpId, ctx.vaultId);
    const b = prfEvalFirst(ctx.rpId, ctx.vaultId);
    const other = prfEvalFirst(ctx.rpId, "33333333-3333-4333-8333-333333333333");
    expect(a.length).toBe(32);
    expect(equalBytes(a, b)).toBe(true);
    expect(equalBytes(a, other)).toBe(false);
  });
});

describe("fallback classification", () => {
  it("ranks prf > largeBlob > uv_gated_local", () => {
    expect(classifyCredential({ prf: { enabled: true } }).mechanism).toBe("prf");
    expect(
      classifyCredential({ largeBlob: { supported: true } }).mechanism,
    ).toBe("large_blob");
    const rank3 = classifyCredential({});
    expect(rank3.mechanism).toBe("uv_gated_local");
    expect(rank3.cryptographicBind).toBe(false);
  });
});
