import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  encryptEntry,
  generateDeviceKey,
  generateSalt,
  generateVaultKey,
  IntegrityError,
  kdfParamsFrom,
  verifySnapshotIntegrity,
  wrapVaultKey,
} from "../src/index.ts";
import type { VaultSnapshot } from "../src/index.ts";

const VAULT_ID = "vault_01HZX4ALLPASS000000000001";

function build(vaultKey: Uint8Array, masterKey: Uint8Array, entryIds: string[]): VaultSnapshot {
  return {
    vaultId: VAULT_ID,
    revision: 4,
    vaultKeyVersion: 2,
    cryptoProtocolVersion: 1,
    envelopes: [
      wrapVaultKey({
        vaultKey,
        wrappingKey: masterKey,
        vaultId: VAULT_ID,
        type: "master",
        kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
      }),
    ],
    entries: entryIds.map((id) =>
      encryptEntry({
        vaultKey,
        vaultId: VAULT_ID,
        entryId: id,
        plaintext: new TextEncoder().encode(`{"title":"${id}"}`),
      }),
    ),
  };
}

describe("verifySnapshotIntegrity", () => {
  it("accepts a consistent snapshot and cross-checks the master envelope", () => {
    const vaultKey = generateVaultKey();
    const masterKey = generateDeviceKey();
    const snapshot = build(vaultKey, masterKey, ["a", "b", "c"]);
    verifySnapshotIntegrity({
      snapshot,
      vaultKey,
      crossChecks: [{ envelope: snapshot.envelopes[0]!, wrappingKey: masterKey }],
    });
  });

  it("rejects a snapshot that mixes entries from another Vault Key", () => {
    const vaultKey = generateVaultKey();
    const masterKey = generateDeviceKey();
    const snapshot = build(vaultKey, masterKey, ["a", "b"]);
    const foreign = build(generateVaultKey(), masterKey, ["c"]);
    snapshot.entries.push(foreign.entries[0]!);
    assert.throws(
      () => verifySnapshotIntegrity({ snapshot, vaultKey }),
      (error: unknown) =>
        error instanceof IntegrityError && /entry c does not decrypt/.test(error.message),
    );
  });

  it("rejects an envelope that unwraps to a different Vault Key", () => {
    const vaultKey = generateVaultKey();
    const masterKey = generateDeviceKey();
    const snapshot = build(vaultKey, masterKey, ["a"]);
    const staleDeviceKey = generateDeviceKey();
    snapshot.envelopes.push(
      wrapVaultKey({
        vaultKey: generateVaultKey(),
        wrappingKey: staleDeviceKey,
        vaultId: VAULT_ID,
        type: "device",
        deviceId: "dev_stale",
      }),
    );
    assert.throws(
      () =>
        verifySnapshotIntegrity({
          snapshot,
          vaultKey,
          crossChecks: [{ envelope: snapshot.envelopes[1]!, wrappingKey: staleDeviceKey }],
        }),
      (error: unknown) =>
        error instanceof IntegrityError && /different Vault Key/.test(error.message),
    );
  });

  it("ignores envelopes this device has no key for", () => {
    const vaultKey = generateVaultKey();
    const snapshot = build(vaultKey, generateDeviceKey(), ["a"]);
    snapshot.envelopes.push(
      wrapVaultKey({
        vaultKey,
        wrappingKey: generateDeviceKey(),
        vaultId: VAULT_ID,
        type: "device",
        deviceId: "dev_someone_else",
      }),
    );
    verifySnapshotIntegrity({ snapshot, vaultKey });
  });

  it("rejects duplicate entry ids and empty envelope sets", () => {
    const vaultKey = generateVaultKey();
    const snapshot = build(vaultKey, generateDeviceKey(), ["a"]);
    snapshot.entries.push(snapshot.entries[0]!);
    assert.throws(() => verifySnapshotIntegrity({ snapshot, vaultKey }), IntegrityError);

    const empty = build(vaultKey, generateDeviceKey(), []);
    empty.envelopes = [];
    assert.throws(() => verifySnapshotIntegrity({ snapshot: empty, vaultKey }), IntegrityError);
  });

  it("rejects a cross-check envelope that is not part of the snapshot", () => {
    const vaultKey = generateVaultKey();
    const masterKey = generateDeviceKey();
    const snapshot = build(vaultKey, masterKey, ["a"]);
    const other = build(vaultKey, masterKey, ["a"]);
    assert.throws(
      () =>
        verifySnapshotIntegrity({
          snapshot,
          vaultKey,
          crossChecks: [{ envelope: other.envelopes[0]!, wrappingKey: masterKey }],
        }),
      IntegrityError,
    );
  });
});
