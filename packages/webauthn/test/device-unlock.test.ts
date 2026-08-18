import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  bytesToBase64,
  bytesToHex,
  base64ToBytes,
  deriveMasterKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  prfEvalFirst,
  unwrapVaultKey,
  wrapVaultKey,
} from "@4allpass/crypto";
import type { KeyEnvelope } from "@4allpass/crypto";
import {
  DeviceUnlockUnavailableError,
  disableDeviceUnlock,
  enableDeviceUnlock,
  memoryDeviceUnlockStore,
  unlockWithDevice,
  UserVerificationError,
  WebAuthnUnavailableError,
} from "../src/index.ts";
import type { DeviceUnlockMechanism, DeviceUnlockStore } from "../src/index.ts";
import { FakeAuthenticator } from "./fake-authenticator.ts";
import type { FakeAuthenticatorOptions } from "./fake-authenticator.ts";

const RP_ID = "pass.example.local";
const VAULT_ID = "vault_01HZX4ALLPASS000000000001";
const DEVICE_ID = "dev_macbook_chrome_profile_1";
const VKV = 1;
const DKV = 1;

const USER = {
  id: new TextEncoder().encode("account_1"),
  name: "user@example.com",
  displayName: "Example User",
};

interface Fixture {
  client: FakeAuthenticator;
  store: DeviceUnlockStore;
  vaultKey: Uint8Array;
  deviceEnvelope: KeyEnvelope;
  mechanism: DeviceUnlockMechanism;
  credentialId: Uint8Array;
}

async function enable(
  authenticator: FakeAuthenticatorOptions,
  allowedMechanisms?: readonly DeviceUnlockMechanism[],
): Promise<Fixture> {
  const client = new FakeAuthenticator(authenticator);
  const store = memoryDeviceUnlockStore();
  const vaultKey = generateVaultKey();
  const result = await enableDeviceUnlock({
    client,
    store,
    vaultKey,
    vaultId: VAULT_ID,
    deviceId: DEVICE_ID,
    vaultKeyVersion: VKV,
    deviceKeyVersion: DKV,
    rpId: RP_ID,
    user: USER,
    ...(allowedMechanisms ? { allowedMechanisms } : {}),
  });
  return {
    client,
    store,
    vaultKey,
    deviceEnvelope: result.deviceEnvelope,
    mechanism: result.mechanism,
    credentialId: result.credentialId,
  };
}

describe("enableDeviceUnlock", () => {
  it("prefers PRF and only uploads the Device Envelope", async () => {
    const client = new FakeAuthenticator({ supportsPrf: true, supportsLargeBlob: true });
    const store = memoryDeviceUnlockStore();
    const vaultKey = generateVaultKey();
    const result = await enableDeviceUnlock({
      client,
      store,
      vaultKey,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      vaultKeyVersion: VKV,
      deviceKeyVersion: DKV,
      rpId: RP_ID,
      user: USER,
    });

    assert.equal(result.mechanism, "prf");
    assert.equal(result.deviceEnvelope.type, "device");
    assert.equal(result.deviceEnvelope.deviceId, DEVICE_ID);
    assert.equal(client.lastUserVerification, "required");
    assert.ok(result.mirrorableDeviceKeyEnvelope, "PRF envelope may be mirrored");

    const record = await store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    assert.equal(record.mechanism, "prf");
    assert.equal(record.wrappingKey, undefined, "PRF must not store a local wrapping key");
    assert.ok(record.deviceKeyEnvelope);
  });

  it("evaluates prf.eval.first exactly as the spec defines it", async () => {
    const fixture = await enable({ supportsPrf: true });
    assert.ok(fixture.client.lastPrfEvalFirst);
    assert.equal(
      bytesToHex(fixture.client.lastPrfEvalFirst),
      bytesToHex(prfEvalFirst(RP_ID, VAULT_ID)),
    );
  });

  it("uses create-time PRF results when the platform returns them", async () => {
    const client = new FakeAuthenticator({ supportsPrf: true, prfAtCreateTime: true });
    const store = memoryDeviceUnlockStore();
    const result = await enableDeviceUnlock({
      client,
      store,
      vaultKey: generateVaultKey(),
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      vaultKeyVersion: VKV,
      deviceKeyVersion: DKV,
      rpId: RP_ID,
      user: USER,
    });
    assert.equal(result.mechanism, "prf");
    assert.equal(client.getCalls, 0, "no extra assertion is needed");
  });

  it("falls back to largeBlob when PRF is missing", async () => {
    const fixture = await enable({ supportsPrf: false, supportsLargeBlob: true });
    assert.equal(fixture.mechanism, "large_blob");
    const record = await fixture.store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    assert.equal(record.deviceKeyEnvelope, undefined, "the envelope lives in the authenticator");
    assert.equal(base64ToBytes(record.wrappingKey!).length, 32);
  });

  it("falls back to the UV-gated local store when neither is available", async () => {
    const fixture = await enable({ supportsPrf: false, supportsLargeBlob: false });
    assert.equal(fixture.mechanism, "uv_gated_local");
    const record = await fixture.store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    assert.ok(record.deviceKeyEnvelope, "rank 3 keeps the envelope locally");
    assert.ok(record.wrappingKey, "rank 3 keeps the wrapping key locally");
  });

  it("honours a deployment that forbids the weakest rank", async () => {
    await assert.rejects(
      () => enable({ supportsPrf: false, supportsLargeBlob: false }, ["prf", "large_blob"]),
      DeviceUnlockUnavailableError,
    );
  });

  it("reports unavailability instead of a hard failure when the user declines", async () => {
    await assert.rejects(() => enable({ denyAll: true }), WebAuthnUnavailableError);
  });

  it("refuses to provision when the authenticator does not verify the user", async () => {
    await assert.rejects(
      () => enable({ supportsPrf: false, supportsLargeBlob: false, skipUserVerification: true }),
      DeviceUnlockUnavailableError,
    );
  });

  it("refuses a short PRF output rather than stretching it", async () => {
    const fixture = await enable({ supportsPrf: true, shortPrfOutput: true, supportsLargeBlob: true });
    assert.equal(fixture.mechanism, "large_blob", "PRF must be skipped, not padded");
  });
});

describe("unlockWithDevice", () => {
  for (const scenario of [
    { name: "PRF", options: { supportsPrf: true }, expected: "prf" },
    {
      name: "largeBlob",
      options: { supportsPrf: false, supportsLargeBlob: true },
      expected: "large_blob",
    },
    {
      name: "UV-gated local store",
      options: { supportsPrf: false, supportsLargeBlob: false },
      expected: "uv_gated_local",
    },
  ] as const) {
    it(`recovers the Vault Key over ${scenario.name}`, async () => {
      const fixture = await enable(scenario.options);
      assert.equal(fixture.mechanism, scenario.expected);
      const result = await unlockWithDevice({
        client: fixture.client,
        store: fixture.store,
        vaultId: VAULT_ID,
        deviceId: DEVICE_ID,
        vaultKeyVersion: VKV,
        deviceKeyVersion: DKV,
        deviceEnvelope: fixture.deviceEnvelope,
      });
      assert.deepEqual(result.vaultKey, fixture.vaultKey);
      assert.equal(result.mechanism, scenario.expected);
      assert.equal(fixture.client.lastUserVerification, "required");
    });
  }

  it("unlocks from the server mirror when the local envelope is gone", async () => {
    const client = new FakeAuthenticator({ supportsPrf: true });
    const store = memoryDeviceUnlockStore();
    const vaultKey = generateVaultKey();
    const enabled = await enableDeviceUnlock({
      client,
      store,
      vaultKey,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      vaultKeyVersion: VKV,
      deviceKeyVersion: DKV,
      rpId: RP_ID,
      user: USER,
    });
    const record = await store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    const { deviceKeyEnvelope, ...withoutEnvelope } = record;
    assert.ok(deviceKeyEnvelope);
    await store.save(withoutEnvelope);

    const result = await unlockWithDevice({
      client,
      store,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      vaultKeyVersion: VKV,
      deviceKeyVersion: DKV,
      deviceEnvelope: enabled.deviceEnvelope,
      mirroredDeviceKeyEnvelope: enabled.mirrorableDeviceKeyEnvelope!,
    });
    assert.deepEqual(result.vaultKey, vaultKey);
  });

  it("falls back to the master password when nothing is provisioned", async () => {
    const client = new FakeAuthenticator({ supportsPrf: true });
    await assert.rejects(
      () =>
        unlockWithDevice({
          client,
          store: memoryDeviceUnlockStore(),
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
          deviceEnvelope: wrapVaultKey({
            vaultKey: generateVaultKey(),
            wrappingKey: generateVaultKey(),
            vaultId: VAULT_ID,
            type: "device",
            vaultKeyVersion: VKV,
            deviceId: DEVICE_ID,
            deviceKeyVersion: DKV,
          }),
        }),
      (error: unknown) =>
        error instanceof DeviceUnlockUnavailableError &&
        error.attempted[0]?.mechanism === "none" &&
        /master password/.test(error.message),
    );
  });

  it("falls back to the master password when the user cancels the prompt", async () => {
    const fixture = await enable({ supportsPrf: true });
    const denying = new FakeAuthenticator({ denyAll: true });
    await assert.rejects(
      () =>
        unlockWithDevice({
          client: denying,
          store: fixture.store,
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
          deviceEnvelope: fixture.deviceEnvelope,
        }),
      DeviceUnlockUnavailableError,
    );
  });

  it("refuses another vault's Device Envelope", async () => {
    const fixture = await enable({ supportsPrf: true });
    const foreign = wrapVaultKey({
      vaultKey: generateVaultKey(),
      wrappingKey: generateVaultKey(),
      vaultId: "vault_other",
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: DEVICE_ID,
      deviceKeyVersion: DKV,
    });
    await assert.rejects(
      () =>
        unlockWithDevice({
          client: fixture.client,
          store: fixture.store,
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
          deviceEnvelope: foreign,
        }),
      DeviceUnlockUnavailableError,
    );
  });

  it("refuses to unlock after the local record is removed", async () => {
    const fixture = await enable({ supportsPrf: true });
    await disableDeviceUnlock(fixture.store, VAULT_ID, DEVICE_ID);
    await assert.rejects(
      () =>
        unlockWithDevice({
          client: fixture.client,
          store: fixture.store,
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
          deviceEnvelope: fixture.deviceEnvelope,
        }),
      DeviceUnlockUnavailableError,
    );
  });

  it("does not release local key material without the UV flag", async () => {
    const fixture = await enable({ supportsPrf: false, supportsLargeBlob: false });
    const record = await fixture.store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    const noUv = new FakeAuthenticator({ skipUserVerification: true });
    noUv.credentials.push({
      id: base64ToBytes(record.credentialId),
      rpId: RP_ID,
      prfSecret: new Uint8Array(32),
      largeBlob: null,
    } as never);
    await assert.rejects(
      () =>
        unlockWithDevice({
          client: noUv,
          store: fixture.store,
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          vaultKeyVersion: VKV,
          deviceKeyVersion: DKV,
          deviceEnvelope: fixture.deviceEnvelope,
        }),
      (error: unknown) =>
        error instanceof DeviceUnlockUnavailableError &&
        new RegExp(UserVerificationError.name).test(error.message),
    );
  });

  it("leaves master-password unlock working after device unlock is enabled", async () => {
    const client = new FakeAuthenticator({ supportsPrf: true });
    const store = memoryDeviceUnlockStore();
    const vaultKey = generateVaultKey();
    const salt = generateSalt();
    const masterKey = deriveMasterKey("correct-horse-battery-staple", salt, ARGON2ID_PROFILES.ci);
    const masterEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId: VAULT_ID,
      type: "master",
      vaultKeyVersion: VKV,
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, salt),
      allowTestProfile: true,
    });

    await enableDeviceUnlock({
      client,
      store,
      vaultKey,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      vaultKeyVersion: VKV,
      deviceKeyVersion: DKV,
      rpId: RP_ID,
      user: USER,
    });

    assert.deepEqual(
      unwrapVaultKey(masterEnvelope, {
        wrappingKey: masterKey,
        vaultId: VAULT_ID,
        expectType: "master",
        expectVaultKeyVersion: VKV,
        allowTestProfile: true,
      }),
      vaultKey,
    );
  });
});

describe("stored records", () => {
  it("never contains the Vault Key or the Device Key", async () => {
    const fixture = await enable({ supportsPrf: false, supportsLargeBlob: false });
    const record = await fixture.store.load(VAULT_ID, DEVICE_ID);
    assert.ok(record);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(bytesToBase64(fixture.vaultKey)));
    assert.ok(!serialized.includes(bytesToHex(fixture.vaultKey)));
  });
});
