import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  assertFreshSnapshot,
  buildManifest,
  decodeVaultSnapshot,
  deriveMasterKey,
  encodeEncryptedEntry,
  encodeKeyEnvelope,
  encodeSealedManifest,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  revisionFromManifest,
  sealManifest,
  unwrapVaultKey,
  verifySnapshot,
  verifySnapshotManifest,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";

describe("client encrypted vault flow", () => {
  it("creates, uploads, verifies, and decrypts without exposing plaintext on the wire", () => {
    const vaultId = "11111111-1111-1111-1111-111111111111";
    const vaultKey = generateVaultKey();
    const salt = generateSalt(16);
    const masterPassword = "account-is-not-the-master-password";
    const masterKey = deriveMasterKey(masterPassword, salt, ARGON2ID_PROFILES.ci, {
      allowTestProfile: true,
    });
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ title: "GitHub", username: "ada", password: "s3cret-entry-value-42" }),
    );

    try {
      const masterEnvelope = wrapVaultKey({
        vaultKey,
        wrappingKey: masterKey,
        vaultId,
        type: "master",
        vaultKeyVersion: 1,
        kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, salt),
        allowTestProfile: true,
      });
      const entry = encryptEntry({
        vaultKey,
        vaultId,
        entryId: "entry_1",
        plaintext,
        vaultKeyVersion: 1,
        schemaVersion: 1,
      });
      const manifest = sealManifest({
        vaultKey,
        manifest: buildManifest({
          vaultId,
          revision: 1,
          vaultKeyVersion: 1,
          envelopes: [masterEnvelope],
          entries: [entry],
        }),
      });
      const wire = encodeVaultSnapshot({
        vaultId,
        revision: 1,
        vaultKeyVersion: 1,
        cryptoProtocolVersion: 1,
        manifest,
        envelopes: [masterEnvelope],
        entries: [entry],
      });
      const serialized = JSON.stringify(wire);
      assert.equal(serialized.includes("s3cret-entry-value-42"), false);
      assert.equal(serialized.includes(masterPassword), false);
      assert.ok(wire.manifest.ciphertext);

      const fetched = decodeVaultSnapshot(JSON.parse(serialized));
      const opened = unwrapVaultKey(fetched.envelopes[0]!, {
        wrappingKey: masterKey,
        vaultId,
        expectType: "master",
        expectVaultKeyVersion: 1,
        allowTestProfile: true,
      });
      const verified = verifySnapshotManifest(
        fetched.manifest,
        { entries: fetched.entries, envelopes: fetched.envelopes },
        {
          vaultKey: opened,
          vaultId,
          revision: fetched.revision,
          vaultKeyVersion: fetched.vaultKeyVersion,
        },
      );
      assertFreshSnapshot(null, revisionFromManifest(verified));
      const decrypted = verifySnapshot({
        vaultId,
        vaultKey: opened,
        vaultKeyVersion: 1,
        entries: verified.entries,
      });
      assert.equal(new TextDecoder().decode(decrypted[0]!.plaintext), new TextDecoder().decode(plaintext));
      assert.deepEqual(encodeSealedManifest(fetched.manifest), wire.manifest);
      assert.deepEqual(encodeKeyEnvelope(verified.envelopes[0]!), encodeKeyEnvelope(masterEnvelope));
      assert.deepEqual(encodeEncryptedEntry(verified.entries[0]!), encodeEncryptedEntry(entry));
    } finally {
      zeroize(masterKey, vaultKey, plaintext);
    }
  });
});
