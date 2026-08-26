import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  IntegrityError,
  assertFreshSnapshot,
  buildManifest,
  bytesToHex,
  decryptEntry,
  deriveDeviceWrappingKey,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  deriveRecoveryWrappingKey,
  encryptEntry,
  formatRecoveryKey,
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  parseRecoveryKey,
  prfEvalFirst,
  revisionFromManifest,
  sealManifest,
  unwrapDeviceKey,
  unwrapVaultKey,
  verifySnapshotManifest,
  wrapDeviceKey,
  wrapVaultKey,
  type EncryptedEntry,
  type KeyEnvelope,
  type VaultRevision,
} from "../src/index.ts";

const VAULT_ID = "vault_e2e_01HZX4ALLPASS0000000001";
const RP_ID = "pass.example.local";
const DEVICE_ID = "dev_e2e_laptop";
const SECOND_DEVICE = "dev_e2e_phone";
const PASSWORD = "correct-horse-battery-staple";
const profile = ARGON2ID_PROFILES.ci;
const testProfile = { allowTestProfile: true } as const;

function entriesFor(vaultKey: Uint8Array, vaultKeyVersion: number, secrets: Record<string, string>) {
  return Object.entries(secrets).map(([entryId, secret]) =>
    encryptEntry({
      vaultKey,
      vaultId: VAULT_ID,
      entryId,
      vaultKeyVersion,
      plaintext: new TextEncoder().encode(secret),
    }),
  );
}

function publish(
  vaultKey: Uint8Array,
  revision: number,
  vaultKeyVersion: number,
  entries: EncryptedEntry[],
  envelopes: KeyEnvelope[],
) {
  const manifest = buildManifest({
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion,
    entries,
    envelopes,
    ...testProfile,
  });
  const sealed = sealManifest({ vaultKey, manifest });
  return { revision, vaultKeyVersion, entries, envelopes, manifest, sealed };
}

describe("end-to-end vault lifecycle", () => {
  it("runs create → enrol → sync → rotate → revoke → recover", () => {
    // ---- create the vault -------------------------------------------------
    const vaultKey = generateVaultKey();
    const salt = generateSalt();
    const masterKey = deriveMasterKey(PASSWORD, salt, profile, testProfile);
    const recoveryKey = generateRecoveryKey();
    const emergencyKit = formatRecoveryKey(recoveryKey);
    const recoveryWrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId: VAULT_ID });

    const master = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId: VAULT_ID,
      type: "master",
      vaultKeyVersion: 1,
      kdf: kdfParamsFrom(profile, salt),
      ...testProfile,
    });
    const recovery = wrapVaultKey({
      vaultKey,
      wrappingKey: recoveryWrappingKey,
      vaultId: VAULT_ID,
      type: "recovery",
      vaultKeyVersion: 1,
    });

    const entries1 = entriesFor(vaultKey, 1, { entry_bank: '{"password":"one"}' });
    const snapshot1 = publish(vaultKey, 1, 1, entries1, [master, recovery]);

    // ---- unlock with the master password ----------------------------------
    const derived = deriveMasterKeyFromEnvelope(PASSWORD, master, testProfile);
    assert.equal(bytesToHex(derived), bytesToHex(masterKey));
    const unlockedVk = unwrapVaultKey(master, {
      wrappingKey: derived,
      vaultId: VAULT_ID,
      expectType: "master",
      expectVaultKeyVersion: 1,
      ...testProfile,
    });
    assert.deepEqual(unlockedVk, vaultKey);

    let pin: VaultRevision | null = null;
    let applied: EncryptedEntry[] = [];
    const accept = (snapshot: ReturnType<typeof publish>, key: Uint8Array) => {
      const verified = verifySnapshotManifest(
        snapshot.sealed,
        { entries: snapshot.entries, envelopes: snapshot.envelopes },
        {
          vaultKey: key,
          vaultId: VAULT_ID,
          revision: snapshot.revision,
          vaultKeyVersion: snapshot.vaultKeyVersion,
          ...testProfile,
        },
      );
      const incoming = revisionFromManifest(verified);
      const action = assertFreshSnapshot(pin, incoming);
      pin = incoming;
      // The client applies the records verification returned, not its own copies.
      applied = verified.entries;
      return action;
    };
    assert.equal(accept(snapshot1, unlockedVk), "first_seen");
    assert.equal(applied.length, 1);

    // ---- enrol this device through WebAuthn PRF ---------------------------
    const credentialId = new Uint8Array(20).fill(0xc1);
    assert.equal(prfEvalFirst(RP_ID, VAULT_ID).length, 32);
    const prfOutput = new Uint8Array(32).fill(0x42); // stand-in for prf.results.first
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId: RP_ID,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      credentialId,
    });
    const deviceKey = generateDeviceKey();
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: dwk,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      credentialId,
      deviceKeyVersion: 1,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: VAULT_ID,
      type: "device",
      vaultKeyVersion: 1,
      deviceId: DEVICE_ID,
      deviceKeyVersion: 1,
    });
    const phoneKey = generateDeviceKey();
    const phoneEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: phoneKey,
      vaultId: VAULT_ID,
      type: "device",
      vaultKeyVersion: 1,
      deviceId: SECOND_DEVICE,
      deviceKeyVersion: 1,
    });

    const entries2 = entriesFor(vaultKey, 1, {
      entry_bank: '{"password":"one"}',
      entry_mail: '{"password":"two"}',
    });
    const snapshot2 = publish(vaultKey, 2, 1, entries2, [
      master,
      recovery,
      deviceEnvelope,
      phoneEnvelope,
    ]);
    assert.equal(accept(snapshot2, vaultKey), "advance");

    // ---- biometric unlock: PRF → DWK → DK → VK ----------------------------
    const recoveredDk = unwrapDeviceKey(deviceKeyEnvelope, {
      deviceWrappingKey: deriveDeviceWrappingKey({
        prfOutput,
        rpId: RP_ID,
        vaultId: VAULT_ID,
        deviceId: DEVICE_ID,
        credentialId,
      }),
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      credentialId,
      deviceKeyVersion: 1,
    });
    assert.deepEqual(recoveredDk, deviceKey);
    const vkFromDevice = unwrapVaultKey(deviceEnvelope, {
      wrappingKey: recoveredDk,
      vaultId: VAULT_ID,
      expectType: "device",
      expectVaultKeyVersion: 1,
      expectDeviceId: DEVICE_ID,
      expectDeviceKeyVersion: 1,
    });
    assert.deepEqual(vkFromDevice, vaultKey);
    const mail = applied.find((record) => record.id === "entry_mail");
    assert.ok(mail);
    assert.equal(
      new TextDecoder().decode(
        decryptEntry(mail, {
          vaultKey: vkFromDevice,
          vaultId: VAULT_ID,
          entryId: "entry_mail",
          vaultKeyVersion: 1,
        }),
      ),
      '{"password":"two"}',
    );

    // ---- rotate this device's Device Key ---------------------------------
    const deviceKey2 = generateDeviceKey();
    const deviceKeyEnvelope2 = wrapDeviceKey({
      deviceKey: deviceKey2,
      deviceWrappingKey: dwk,
      vaultId: VAULT_ID,
      deviceId: DEVICE_ID,
      credentialId,
      deviceKeyVersion: 2,
    });
    const deviceEnvelope2 = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey2,
      vaultId: VAULT_ID,
      type: "device",
      vaultKeyVersion: 1,
      deviceId: DEVICE_ID,
      deviceKeyVersion: 2,
    });
    const snapshot3 = publish(vaultKey, 3, 1, entries2, [
      master,
      recovery,
      deviceEnvelope2,
      phoneEnvelope,
    ]);
    assert.equal(accept(snapshot3, vaultKey), "advance");

    // the superseded generation is refused on both layers
    assert.throws(
      () =>
        unwrapDeviceKey(deviceKeyEnvelope, {
          deviceWrappingKey: dwk,
          vaultId: VAULT_ID,
          deviceId: DEVICE_ID,
          credentialId,
          deviceKeyVersion: 2,
        }),
      IntegrityError,
    );
    assert.throws(
      () =>
        verifySnapshotManifest(
          snapshot3.sealed,
          { entries: snapshot3.entries, envelopes: [master, recovery, deviceEnvelope, phoneEnvelope] },
          { vaultKey, vaultId: VAULT_ID, revision: 3, vaultKeyVersion: 1, ...testProfile },
        ),
      IntegrityError,
    );
    assert.deepEqual(
      unwrapDeviceKey(deviceKeyEnvelope2, {
        deviceWrappingKey: dwk,
        vaultId: VAULT_ID,
        deviceId: DEVICE_ID,
        credentialId,
        deviceKeyVersion: 2,
      }),
      deviceKey2,
    );

    // ---- hard revocation of the phone: rotate the Vault Key --------------
    const vaultKey2 = generateVaultKey();
    const salt2 = generateSalt();
    const masterKey2 = deriveMasterKey(PASSWORD, salt2, profile, testProfile);
    const master2 = wrapVaultKey({
      vaultKey: vaultKey2,
      wrappingKey: masterKey2,
      vaultId: VAULT_ID,
      type: "master",
      vaultKeyVersion: 2,
      kdf: kdfParamsFrom(profile, salt2),
      ...testProfile,
    });
    const recovery2 = wrapVaultKey({
      vaultKey: vaultKey2,
      wrappingKey: recoveryWrappingKey,
      vaultId: VAULT_ID,
      type: "recovery",
      vaultKeyVersion: 2,
    });
    const deviceEnvelope3 = wrapVaultKey({
      vaultKey: vaultKey2,
      wrappingKey: deviceKey2,
      vaultId: VAULT_ID,
      type: "device",
      vaultKeyVersion: 2,
      deviceId: DEVICE_ID,
      deviceKeyVersion: 2,
    });
    const rotatedEntries = entriesFor(vaultKey2, 2, {
      entry_bank: '{"password":"one"}',
      entry_mail: '{"password":"two"}',
    });
    const snapshot4 = publish(vaultKey2, 4, 2, rotatedEntries, [master2, recovery2, deviceEnvelope3]);
    assert.equal(accept(snapshot4, vaultKey2), "rotation");

    // the revoked phone key is now useless, and its old envelope cannot come back
    assert.throws(
      () =>
        unwrapVaultKey(phoneEnvelope, {
          wrappingKey: phoneKey,
          vaultId: VAULT_ID,
          expectType: "device",
          expectVaultKeyVersion: 2,
          expectDeviceId: SECOND_DEVICE,
          expectDeviceKeyVersion: 1,
        }),
      IntegrityError,
    );
    assert.throws(
      () =>
        verifySnapshotManifest(
          snapshot4.sealed,
          { entries: snapshot4.entries, envelopes: [...snapshot4.envelopes, phoneEnvelope] },
          { vaultKey: vaultKey2, vaultId: VAULT_ID, revision: 4, vaultKeyVersion: 2, ...testProfile },
        ),
      IntegrityError,
    );

    // pre-rotation entries no longer decrypt under the new key
    assert.throws(
      () =>
        decryptEntry(snapshot2.entries[0] as EncryptedEntry, {
          vaultKey: vaultKey2,
          vaultId: VAULT_ID,
          entryId: "entry_bank",
          vaultKeyVersion: 2,
        }),
      IntegrityError,
    );

    // ---- a replayed pre-rotation snapshot is refused ---------------------
    assert.throws(() => accept(snapshot2, vaultKey), Error);

    // ---- recovery from the Emergency Kit ---------------------------------
    const typedByHand = emergencyKit.toLowerCase().replace(/-/g, " ");
    const parsed = parseRecoveryKey(typedByHand);
    assert.deepEqual(parsed, recoveryKey);
    const vkFromRecovery = unwrapVaultKey(recovery2, {
      wrappingKey: deriveRecoveryWrappingKey({ recoveryKey: parsed, vaultId: VAULT_ID }),
      vaultId: VAULT_ID,
      expectType: "recovery",
      expectVaultKeyVersion: 2,
    });
    assert.deepEqual(vkFromRecovery, vaultKey2);
    assert.equal(
      new TextDecoder().decode(
        decryptEntry(snapshot4.entries[0] as EncryptedEntry, {
          vaultKey: vkFromRecovery,
          vaultId: VAULT_ID,
          entryId: "entry_bank",
          vaultKeyVersion: 2,
        }),
      ),
      '{"password":"one"}',
    );

    // ---- the old master password still works, the old master key does not -
    assert.throws(
      () =>
        unwrapVaultKey(master2, {
          wrappingKey: masterKey,
          vaultId: VAULT_ID,
          expectType: "master",
          expectVaultKeyVersion: 2,
          ...testProfile,
        }),
      AuthFailureError,
    );
    assert.deepEqual(
      unwrapVaultKey(master2, {
        wrappingKey: deriveMasterKeyFromEnvelope(PASSWORD, master2, testProfile),
        vaultId: VAULT_ID,
        expectType: "master",
        expectVaultKeyVersion: 2,
        ...testProfile,
      }),
      vaultKey2,
    );
  });
});
