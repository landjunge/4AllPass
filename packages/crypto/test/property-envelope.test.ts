/**
 * Property tests for envelope wrap/unwrap (development-plan B3).
 *
 * Complements KATs and the adversarial suite: random keys, ids and versions
 * instead of fixed vectors. Master envelopes are out — they need Argon2id.
 * Wrong wrapping key / tampered AEAD material → AuthFailureError.
 * Wrong caller expectation (type, device, entry id) → IntegrityError.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import {
  AuthFailureError,
  IntegrityError,
  decryptEntry,
  encryptEntry,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapVaultKey,
} from "../src/index.ts";

const RUNS = 64;

const keyArb = fc.uint8Array({ minLength: 32, maxLength: 32 });
const hexChar = fc.constantFrom(..."0123456789abcdef");
const idArb = fc.array(hexChar, { minLength: 8, maxLength: 32 }).map((chars) => `id_${chars.join("")}`);
const versionArb = fc.integer({ min: 1, max: 10_000 });
const credentialArb = fc.uint8Array({ minLength: 16, maxLength: 64 });
const plaintextArb = fc.uint8Array({ minLength: 0, maxLength: 256 });

describe("property: vault-key envelopes", () => {
  it("device wrap/unwrap round-trips random keys and identities", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, idArb, versionArb, versionArb, (vaultKey, wrappingKey, vaultId, deviceId, vaultKeyVersion, deviceKeyVersion) => {
        const envelope = wrapVaultKey({
          vaultKey,
          wrappingKey,
          vaultId,
          type: "device",
          vaultKeyVersion,
          deviceId,
          deviceKeyVersion,
        });
        const opened = unwrapVaultKey(envelope, {
          wrappingKey,
          vaultId,
          expectType: "device",
          expectVaultKeyVersion: vaultKeyVersion,
          expectDeviceId: deviceId,
          expectDeviceKeyVersion: deviceKeyVersion,
        });
        assert.deepEqual(opened, vaultKey);
      }),
      { numRuns: RUNS },
    );
  });

  it("recovery wrap/unwrap round-trips", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, versionArb, (vaultKey, wrappingKey, vaultId, vaultKeyVersion) => {
        const envelope = wrapVaultKey({
          vaultKey,
          wrappingKey,
          vaultId,
          type: "recovery",
          vaultKeyVersion,
        });
        const opened = unwrapVaultKey(envelope, {
          wrappingKey,
          vaultId,
          expectType: "recovery",
          expectVaultKeyVersion: vaultKeyVersion,
        });
        assert.deepEqual(opened, vaultKey);
      }),
      { numRuns: RUNS },
    );
  });

  it("wrong wrapping key is AuthFailureError, not a successful unwrap", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, idArb, versionArb, (vaultKey, wrappingKey, vaultId, deviceId, vaultKeyVersion) => {
        const envelope = wrapVaultKey({
          vaultKey,
          wrappingKey,
          vaultId,
          type: "device",
          vaultKeyVersion,
          deviceId,
          deviceKeyVersion: 1,
        });
        const otherKey = wrappingKey.slice();
        otherKey[0] = (otherKey[0] ?? 0) ^ 0xff;
        assert.throws(
          () =>
            unwrapVaultKey(envelope, {
              wrappingKey: otherKey,
              vaultId,
              expectType: "device",
              expectVaultKeyVersion: vaultKeyVersion,
              expectDeviceId: deviceId,
              expectDeviceKeyVersion: 1,
            }),
          AuthFailureError,
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("expecting a different envelope type is IntegrityError", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, idArb, versionArb, (vaultKey, wrappingKey, vaultId, deviceId, vaultKeyVersion) => {
        const envelope = wrapVaultKey({
          vaultKey,
          wrappingKey,
          vaultId,
          type: "device",
          vaultKeyVersion,
          deviceId,
          deviceKeyVersion: 1,
        });
        assert.throws(
          () =>
            unwrapVaultKey(envelope, {
              wrappingKey,
              vaultId,
              expectType: "recovery",
              expectVaultKeyVersion: vaultKeyVersion,
            }),
          IntegrityError,
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("expecting a different device id is IntegrityError", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, idArb, idArb, versionArb, (vaultKey, wrappingKey, vaultId, deviceId, otherDevice, vaultKeyVersion) => {
        fc.pre(deviceId !== otherDevice);
        const envelope = wrapVaultKey({
          vaultKey,
          wrappingKey,
          vaultId,
          type: "device",
          vaultKeyVersion,
          deviceId,
          deviceKeyVersion: 1,
        });
        assert.throws(
          () =>
            unwrapVaultKey(envelope, {
              wrappingKey,
              vaultId,
              expectType: "device",
              expectVaultKeyVersion: vaultKeyVersion,
              expectDeviceId: otherDevice,
              expectDeviceKeyVersion: 1,
            }),
          IntegrityError,
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("a flipped ciphertext, tag, or nonce byte is AuthFailureError", () => {
    fc.assert(
      fc.property(
        keyArb,
        keyArb,
        idArb,
        idArb,
        versionArb,
        fc.constantFrom("ciphertext", "tag", "nonce") as fc.Arbitrary<"ciphertext" | "tag" | "nonce">,
        (vaultKey, wrappingKey, vaultId, deviceId, vaultKeyVersion, field) => {
          const envelope = wrapVaultKey({
            vaultKey,
            wrappingKey,
            vaultId,
            type: "device",
            vaultKeyVersion,
            deviceId,
            deviceKeyVersion: 1,
          });
          const mutated = envelope[field].slice();
          mutated[0] = (mutated[0] ?? 0) ^ 0xff;
          assert.throws(
            () =>
              unwrapVaultKey(
                { ...envelope, [field]: mutated },
                {
                  wrappingKey,
                  vaultId,
                  expectType: "device",
                  expectVaultKeyVersion: vaultKeyVersion,
                  expectDeviceId: deviceId,
                  expectDeviceKeyVersion: 1,
                },
              ),
            AuthFailureError,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("property: device-key envelopes", () => {
  it("wrap/unwrap round-trips", () => {
    fc.assert(
      fc.property(keyArb, keyArb, idArb, idArb, credentialArb, versionArb, (deviceKey, deviceWrappingKey, vaultId, deviceId, credentialId, deviceKeyVersion) => {
        const envelope = wrapDeviceKey({
          deviceKey,
          deviceWrappingKey,
          vaultId,
          deviceId,
          credentialId,
          deviceKeyVersion,
        });
        const opened = unwrapDeviceKey(envelope, {
          deviceWrappingKey,
          vaultId,
          deviceId,
          credentialId,
          deviceKeyVersion,
        });
        assert.deepEqual(opened, deviceKey);
      }),
      { numRuns: RUNS },
    );
  });

  it("wrong vault, device, credential or generation is IntegrityError", () => {
    fc.assert(
      fc.property(
        keyArb,
        keyArb,
        idArb,
        idArb,
        idArb,
        credentialArb,
        credentialArb,
        versionArb,
        versionArb,
        (deviceKey, dwk, vaultId, otherVault, deviceId, credentialId, otherCred, deviceKeyVersion, otherGen) => {
          fc.pre(vaultId !== otherVault);
          fc.pre(deviceKeyVersion !== otherGen);
          fc.pre(credentialId.length !== otherCred.length || credentialId.some((byte, i) => byte !== otherCred[i]));
          const envelope = wrapDeviceKey({
            deviceKey,
            deviceWrappingKey: dwk,
            vaultId,
            deviceId,
            credentialId,
            deviceKeyVersion,
          });
          assert.throws(
            () =>
              unwrapDeviceKey(envelope, {
                deviceWrappingKey: dwk,
                vaultId: otherVault,
                deviceId,
                credentialId,
                deviceKeyVersion,
              }),
            IntegrityError,
          );
          assert.throws(
            () =>
              unwrapDeviceKey(envelope, {
                deviceWrappingKey: dwk,
                vaultId,
                deviceId,
                credentialId,
                deviceKeyVersion: otherGen,
              }),
            IntegrityError,
          );
          assert.throws(
            () =>
              unwrapDeviceKey(envelope, {
                deviceWrappingKey: dwk,
                vaultId,
                deviceId,
                credentialId: otherCred,
                deviceKeyVersion,
              }),
            IntegrityError,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("property: entries", () => {
  it("encrypt/decrypt round-trips", () => {
    fc.assert(
      fc.property(keyArb, idArb, idArb, versionArb, plaintextArb, (vaultKey, vaultId, entryId, vaultKeyVersion, plaintext) => {
        const entry = encryptEntry({ vaultKey, vaultId, entryId, vaultKeyVersion, plaintext });
        assert.deepEqual(decryptEntry(entry, { vaultKey, vaultId, entryId, vaultKeyVersion }), plaintext);
      }),
      { numRuns: RUNS },
    );
  });

  it("asking for a different entryId is IntegrityError", () => {
    fc.assert(
      fc.property(keyArb, idArb, idArb, idArb, versionArb, plaintextArb, (vaultKey, vaultId, entryId, otherId, vaultKeyVersion, plaintext) => {
        fc.pre(entryId !== otherId);
        const entry = encryptEntry({ vaultKey, vaultId, entryId, vaultKeyVersion, plaintext });
        assert.throws(
          () => decryptEntry(entry, { vaultKey, vaultId, entryId: otherId, vaultKeyVersion }),
          IntegrityError,
        );
      }),
      { numRuns: RUNS },
    );
  });
});
