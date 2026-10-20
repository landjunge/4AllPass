/** Synthetic API/storage only: failed content opens must never move the pin. */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  IntegrityError,
  RollbackError,
  buildManifest,
  deriveRecoveryWrappingKey,
  encodeVaultSnapshot,
  encryptEntry,
  formatRecoveryKey,
  generateRecoveryKey,
  generateVaultKey,
  sealManifest,
  sealedManifestDigest,
  wrapVaultKey,
  zeroize,
  type VaultRevision,
} from "@4allpass/crypto";

import { api } from "./api.ts";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { unlockWithRecoveryKey } from "./vault-session.ts";

const originalGet = api.getSnapshot.bind(api);
afterEach(() => {
  clearTestStorage();
  api.getSnapshot = originalGet;
});

type InvalidContent = "aead" | "plaintext" | "sorting" | null;

function fixture(vaultId: string) {
  const vaultKey = generateVaultKey();
  const wrongKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const recovery = wrapVaultKey({
    vaultKey, wrappingKey, vaultId, type: "recovery", vaultKeyVersion: 1,
  });
  const shareKey = formatRecoveryKey(recoveryKey);

  function snapshot(revision: number, manifest: boolean, invalid: InvalidContent = null) {
    const item: VaultEntry = {
      ...emptyDraft(),
      id: "entry-1",
      title: "Synthetic title",
      username: "synthetic",
      password: "dummy-only",
      url: "https://example.invalid",
      updatedAt: "2026-10-20T00:00:00Z",
    };
    const plaintext = invalid === "plaintext"
      ? new TextEncoder().encode("{not valid JSON")
      : invalid === "sorting"
        ? new TextEncoder().encode(JSON.stringify({ ...item, title: { not: "a string" } }))
        : encodeEntryPlaintext(item);
    const entry = encryptEntry({
      vaultKey: invalid === "aead" ? wrongKey : vaultKey,
      vaultId, entryId: item.id, vaultKeyVersion: 1, schemaVersion: 1, plaintext,
    });
    zeroize(plaintext);

    // Two entries ensure sort actually compares the malformed title.
    const goodPlaintext = encodeEntryPlaintext(item);
    const entries = invalid === "sorting"
      ? [encryptEntry({
        vaultKey, vaultId, entryId: "entry-good", vaultKeyVersion: 1,
        schemaVersion: 1, plaintext: goodPlaintext,
      }), entry]
      : [entry];
    zeroize(goodPlaintext);
    const envelopes = [recovery];
    // The manifest is valid even when a described entry cannot decrypt/decode.
    const sealedManifest = manifest
      ? sealManifest({
        vaultKey,
        manifest: buildManifest({ vaultId, revision, vaultKeyVersion: 1, entries, envelopes }),
      })
      : undefined;
    const wire = encodeVaultSnapshot({
      vaultId, revision, vaultKeyVersion: 1, cryptoProtocolVersion: 1, entries, envelopes,
      ...(sealedManifest ? { sealedManifest } : {}),
    });
    const pin: VaultRevision = {
      vaultId, revision, vaultKeyVersion: 1, cryptoProtocolVersion: 1,
      ...(sealedManifest ? { manifestDigest: sealedManifestDigest(sealedManifest) } : {}),
    };
    return { wire, pin };
  }

  return {
    shareKey,
    snapshot,
    dispose: () => zeroize(vaultKey, wrongKey, recoveryKey, wrappingKey),
  };
}

for (const manifest of [false, true]) {
  for (const invalid of ["aead", "plaintext", "sorting"] as const) {
    test(`${manifest ? "manifest" : "legacy"}: failed ${invalid} keeps old pin and honest state remains openable`, async () => {
      const vaultId = `pin-content-${manifest}-${invalid}`;
      const f = fixture(vaultId);
      try {
        const honest = f.snapshot(2, manifest);
        savePin(honest.pin);
        const prior = loadPin(vaultId);
        api.getSnapshot = async () => f.snapshot(3, manifest, invalid).wire;
        if (invalid === "aead") {
          await assert.rejects(() => unlockWithRecoveryKey(vaultId, f.shareKey), IntegrityError);
        } else {
          await assert.rejects(() => unlockWithRecoveryKey(vaultId, f.shareKey));
        }
        assert.deepEqual(loadPin(vaultId), prior, "failed content open must not commit revision or digest");
        api.getSnapshot = async () => honest.wire;
        const opened = await unlockWithRecoveryKey(vaultId, f.shareKey);
        assert.equal(opened.entries[0]?.title, "Synthetic title");
        zeroize(opened.vaultKey);
        assert.deepEqual(loadPin(vaultId), prior);
      } finally {
        f.dispose();
      }
    });
  }
}

for (const manifest of [false, true]) {
  test(`${manifest ? "manifest" : "legacy"}: valid higher state advances exact pin and real rollback stays denied`, async () => {
    const vaultId = `pin-content-valid-${manifest}`;
    const f = fixture(vaultId);
    try {
      const old = f.snapshot(2, manifest);
      const higher = f.snapshot(3, manifest);
      savePin(old.pin);
      api.getSnapshot = async () => higher.wire;
      const opened = await unlockWithRecoveryKey(vaultId, f.shareKey);
      zeroize(opened.vaultKey);
      assert.equal(opened.revision, 3);
      assert.deepEqual(loadPin(vaultId), higher.pin);
      api.getSnapshot = async () => old.wire;
      await assert.rejects(() => unlockWithRecoveryKey(vaultId, f.shareKey), RollbackError);
      assert.deepEqual(loadPin(vaultId), higher.pin);
    } finally {
      f.dispose();
    }
  });
}

test("digest-pinned state rejects a later manifestless state without changing the verified pin", async () => {
  const vaultId = "pin-content-missing-manifest";
  const f = fixture(vaultId);
  try {
    const honest = f.snapshot(2, true);
    savePin(honest.pin);
    api.getSnapshot = async () => f.snapshot(3, false).wire;
    await assert.rejects(() => unlockWithRecoveryKey(vaultId, f.shareKey), IntegrityError);
    assert.deepEqual(loadPin(vaultId), honest.pin);
  } finally {
    f.dispose();
  }
});
