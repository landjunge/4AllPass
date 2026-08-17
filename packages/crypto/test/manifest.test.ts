import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  assertSnapshotMatchesManifest,
  bytesToHex,
  decodeManifest,
  encodeManifest,
  encryptEntry,
  entryDigest,
  generateVaultKey,
  hexToBytes,
  openManifest,
  sealManifest,
  verifySnapshot,
} from "../src/index.ts";
import { buildManifest, concat, frame, type SnapshotManifest } from "../src/index.ts";
import { MANIFEST_CONTENT_LABEL } from "../src/constants.ts";
import { aesSuite, C, VKV, fixtureSealedManifest, fixtureSnapshot, vaultKey, vec } from "./fixtures.ts";

/** Like `encodeManifest`, but keeps the caller's record order instead of canonicalizing. */
function encodeManifestPreservingOrder(manifest: SnapshotManifest): Uint8Array {
  const parts = [
    frame([
      MANIFEST_CONTENT_LABEL,
      manifest.vaultId,
      manifest.cryptoProtocolVersion,
      manifest.revision,
      manifest.vaultKeyVersion,
      manifest.entries.length,
      manifest.envelopes.length,
    ]),
  ];
  for (const entry of manifest.entries) {
    parts.push(
      frame([entry.id, entry.schemaVersion, entry.cryptoVersion, entry.vaultKeyVersion, entry.digest]),
    );
  }
  for (const envelope of manifest.envelopes) {
    parts.push(
      frame([
        envelope.type,
        envelope.deviceId,
        envelope.vaultKeyVersion,
        envelope.deviceKeyVersion,
        envelope.digest,
      ]),
    );
  }
  return concat(...parts);
}

describe("snapshot manifest", () => {
  it("reproduces the pinned manifest body byte for byte", () => {
    const { manifest } = fixtureSnapshot();
    assert.equal(bytesToHex(encodeManifest(manifest)), aesSuite.manifest.body);
  });

  it("reproduces the pinned entry and envelope digests", () => {
    const { manifest } = fixtureSnapshot();
    assert.equal(bytesToHex(manifest.entries[0]?.digest as Uint8Array), aesSuite.manifest.entries[0]?.digest);
    for (const ref of aesSuite.manifest.envelopes) {
      const got = manifest.envelopes.find((e) => e.type === ref.type && e.deviceId === ref.device_id);
      assert.ok(got, `${ref.type} ${ref.device_id}`);
      assert.equal(bytesToHex(got.digest), ref.digest);
    }
  });

  it("reproduces TV-MANIFEST-01 ciphertext and tag", () => {
    const v = vec("TV-MANIFEST-01");
    const { manifest } = fixtureSnapshot();
    const sealed = fixtureSealedManifest(manifest);
    assert.equal(bytesToHex(sealed.ciphertext), v.ciphertext);
    assert.equal(bytesToHex(sealed.tag), v.tag);
  });

  it("round-trips through seal / open / verify", () => {
    const { manifest, entries, envelopes } = fixtureSnapshot();
    const sealed = sealManifest({ vaultKey, manifest });
    const { manifest: opened } = verifySnapshot(
      sealed,
      { entries, envelopes },
      {
        vaultKey,
        vaultId: C.vault_id,
        revision: C.revision,
        vaultKeyVersion: VKV,
      },
    );
    assert.equal(opened.revision, C.revision);
    assert.equal(opened.entries.length, 1);
    assert.equal(opened.envelopes.length, 3);
  });

  it("decodes what it encodes", () => {
    const { manifest } = fixtureSnapshot();
    const decoded = decodeManifest(encodeManifest(manifest));
    assert.deepEqual(decoded, manifest);
  });

  it("refuses a manifest body with trailing bytes", () => {
    const { manifest } = fixtureSnapshot();
    const body = encodeManifest(manifest);
    const padded = new Uint8Array(body.length + 1);
    padded.set(body);
    assert.throws(() => decodeManifest(padded), ProtocolError);
  });

  it("refuses a truncated manifest body", () => {
    const { manifest } = fixtureSnapshot();
    const body = encodeManifest(manifest);
    assert.throws(() => decodeManifest(body.slice(0, body.length - 4)), ProtocolError);
  });

  it("refuses a manifest body whose records are not in canonical order", () => {
    const { entries, envelopes } = fixtureSnapshot();
    const second = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_zzz_last",
      vaultKeyVersion: VKV,
      plaintext: new TextEncoder().encode("{}"),
    });
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: C.revision,
      vaultKeyVersion: VKV,
      entries: [...entries, second],
      envelopes,
    });
    const shuffled = {
      ...manifest,
      entries: [...manifest.entries].reverse(),
      envelopes: [...manifest.envelopes].reverse(),
    };
    // encodeManifest canonicalizes, so a hand-built wire encoding is needed:
    const wire = encodeManifestPreservingOrder(shuffled);
    assert.throws(() => decodeManifest(wire), ProtocolError);
    assert.deepEqual(decodeManifest(encodeManifest(shuffled)), manifest);
  });

  it("refuses to digest a record whose byte fields are malformed", () => {
    const { entry, envelopes } = fixtureSnapshot();
    const broken = { ...entry, tag: entry.tag.slice(0, 8) };
    assert.throws(
      () =>
        buildManifest({
          vaultId: C.vault_id,
          revision: C.revision,
          vaultKeyVersion: VKV,
          entries: [broken],
          envelopes,
        }),
      ProtocolError,
    );
  });

  it("refuses a manifest whose entries span two vault key generations", () => {
    const { entries, envelopes } = fixtureSnapshot();
    const foreign = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_from_the_previous_epoch",
      vaultKeyVersion: VKV - 1,
      plaintext: new TextEncoder().encode("{}"),
    });
    assert.throws(
      () =>
        assertSnapshotMatchesManifest(fixtureSnapshot().manifest, {
          entries: [...entries, foreign],
          envelopes,
        }),
      IntegrityError,
    );
  });

  it("refuses a manifest sealed under a different vault key", () => {
    const { manifest } = fixtureSnapshot();
    const sealed = sealManifest({ vaultKey, manifest });
    assert.throws(
      () =>
        openManifest(sealed, {
          vaultKey: generateVaultKey(),
          vaultId: C.vault_id,
          revision: C.revision,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("keeps the entry digest sensitive to every sealed byte", () => {
    const { entry } = fixtureSnapshot();
    const before = bytesToHex(entryDigest(entry));
    const ciphertext = Uint8Array.from(entry.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0x01;
    const flipped = { ...entry, ciphertext };
    assert.notEqual(bytesToHex(entryDigest(flipped)), before);
    assert.notEqual(bytesToHex(entryDigest({ ...entry, schemaVersion: 2 })), before);
    assert.notEqual(bytesToHex(entryDigest({ ...entry, vaultKeyVersion: VKV + 1 })), before);
  });

  it("pins the manifest body digest", () => {
    const { manifest } = fixtureSnapshot();
    const body = encodeManifest(manifest);
    assert.equal(bytesToHex(hexToBytes(aesSuite.manifest.body)), bytesToHex(body));
  });
});
