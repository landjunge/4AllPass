/**
 * AP-P04-V2-MANIFEST-LIB-20261114 — shared-library candidate boundary tests.
 * Uses Root's explicit cryptoProtocolVersion opt-in on seal/open/verify and
 * decodeManifest/decodeSealedManifest/decodeVaultSnapshot; defaults remain v1.
 * Synthetic existing vectors only. No pin persistence, transport or activation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  buildManifest,
  bytesToHex,
  concat,
  decodeManifest,
  decodeSealedManifest,
  decodeVaultSnapshot,
  decrypt,
  decryptEntry,
  encodeAad,
  encodeManifest,
  encodeSealedManifest,
  encodeVaultSnapshot,
  encrypt,
  frame,
  manifestAad,
  openManifest,
  sealManifest,
  sealedManifestDigest,
  verifySnapshotManifest,
  versionField,
  type SealedManifest,
  type SnapshotManifest,
} from "../src/index.ts";
import { CRYPTO_PROTOCOL_VERSION } from "../src/constants.ts";
import { aesSuite, C, VKV, fixtureSealedManifest, fixtureSnapshot, vaultKey, vec } from "./fixtures.ts";

const V2 = { cryptoProtocolVersion: 2 };
const expected = {
  vaultKey,
  vaultId: C.vault_id,
  revision: C.revision,
  vaultKeyVersion: VKV,
  allowTestProfile: true,
};

function candidate(version: 1 | 2 = 2) {
  const { entries, envelopes } = fixtureSnapshot();
  const manifest = buildManifest({
    ...expected, entries, envelopes, cryptoProtocolVersion: version,
  });
  const sealed = sealManifest({ vaultKey, manifest, cryptoProtocolVersion: version });
  const snapshot = {
    vaultId: C.vault_id,
    revision: C.revision,
    vaultKeyVersion: VKV,
    cryptoProtocolVersion: version,
    entries,
    envelopes,
    sealedManifest: sealed,
  };
  return { entries, envelopes, manifest, sealed, snapshot };
}

// Independent expected domain/framing, rather than reusing the label selector
// under test. The existing framing primitives and authenticated child digests
// are unchanged. Raw bodies let us create well-authenticated invalid contracts.
function rawBody(manifest: SnapshotManifest, label = "4allpass-manifest-content-v2") {
  return concat(
    frame([
      label, manifest.vaultId, manifest.cryptoProtocolVersion, manifest.revision,
      manifest.vaultKeyVersion, manifest.entries.length, manifest.envelopes.length,
    ]),
    ...manifest.entries.map((entry) => frame([
      entry.id, entry.schemaVersion, entry.cryptoVersion, entry.vaultKeyVersion, entry.digest,
    ])),
    ...manifest.envelopes.map((envelope) => frame([
      envelope.type, envelope.deviceId, envelope.vaultKeyVersion,
      envelope.deviceKeyVersion, envelope.digest,
    ])),
  );
}

function rawAad(label = "4allpass-manifest-v2", version = 2) {
  return encodeAad([
    label, C.vault_id, versionField(version), versionField(C.revision), versionField(VKV),
  ]);
}

function rawSealed(body: Uint8Array, aad = rawAad()): SealedManifest {
  // Production primitive owns a fresh nonce even for deliberately invalid data.
  return { version: 2, encryption: "AES-256-GCM", ...encrypt(vaultKey, body, aad) };
}

function flip(bytes: Uint8Array) {
  const out = Uint8Array.from(bytes);
  assert.ok(out.length > 0);
  out[0] = (out[0] ?? 0) ^ 1;
  return out;
}

// Supported versions that disagree may be reported as a wire-format refusal
// or an authenticated identity mismatch. Never accept arbitrary exceptions.
function versionRejected(error: unknown): boolean {
  return error instanceof ProtocolError || error instanceof IntegrityError;
}

describe("P04 candidate: explicit v2 manifest boundary, v1 defaults preserved", () => {
  it("round-trips v2 through ordinary wire, body, open and complete-set verification", () => {
    const c = candidate();
    const wire = JSON.parse(JSON.stringify(encodeVaultSnapshot(c.snapshot))) as unknown;
    const decoded = decodeVaultSnapshot(wire, V2);
    assert.deepEqual(decoded, c.snapshot);
    assert.ok(decoded.sealedManifest);
    assert.deepEqual(decodeSealedManifest(encodeSealedManifest(c.sealed), V2), c.sealed);
    assert.deepEqual(decodeManifest(encodeManifest(c.manifest), V2), c.manifest);
    const opened = openManifest(decoded.sealedManifest, { ...expected, ...V2 });
    const verified = verifySnapshotManifest(decoded.sealedManifest, decoded, { ...expected, ...V2 });
    assert.deepEqual(opened.manifest, c.manifest);
    assert.deepEqual(verified.manifest, c.manifest);
    assert.deepEqual(verified.sealedDigest, sealedManifestDigest(decoded.sealedManifest));
    assert.deepEqual(verified.entries, c.entries);
    assert.deepEqual(verified.envelopes, c.envelopes);
    // Protocol 2 is not a new child encryption format or key generation.
    assert.equal(verified.manifest.cryptoProtocolVersion, 2);
    assert.equal(verified.manifest.vaultKeyVersion, VKV);
    assert.ok(VKV > 1);
    assert.ok(verified.entries.every((entry) => entry.cryptoVersion === 1 && entry.schemaVersion === 1));
    assert.ok(verified.envelopes.every((envelope) => envelope.version === 1));
    const entry = verified.entries[0];
    assert.ok(entry);
    assert.equal(new TextDecoder().decode(decryptEntry(entry, {
      vaultKey, vaultId: C.vault_id, entryId: entry.id, vaultKeyVersion: VKV,
    })), vec("TV-ENTRY-01").notes?.plaintext_utf8);
  });

  it("pins the exact v2 body and AAD domains independently of their implementation selectors", () => {
    const c = candidate();
    const body = rawBody(c.manifest);
    assert.deepEqual(encodeManifest(c.manifest), body);
    assert.deepEqual(manifestAad({
      vaultId: C.vault_id, cryptoVersion: 2, revision: C.revision, vaultKeyVersion: VKV,
    }), rawAad());
    assert.deepEqual(decrypt(vaultKey, c.sealed.nonce, c.sealed.ciphertext, c.sealed.tag, rawAad()), body);
    // Positive control for the raw attack constructor, so its negative cases
    // cannot pass merely because every hand-constructed ciphertext is invalid.
    assert.deepEqual(verifySnapshotManifest(rawSealed(body), c, { ...expected, ...V2 }).manifest, c.manifest);
  });

  it("retains v1 defaults and the existing body, ciphertext, tag and AAD vectors", () => {
    const c = fixtureSnapshot();
    assert.equal(CRYPTO_PROTOCOL_VERSION, 1);
    assert.equal(c.manifest.cryptoProtocolVersion, 1);
    assert.equal(bytesToHex(encodeManifest(c.manifest)), aesSuite.manifest.body);
    const pinned = fixtureSealedManifest(c.manifest);
    assert.equal(bytesToHex(pinned.ciphertext), vec("TV-MANIFEST-01").ciphertext);
    assert.equal(bytesToHex(pinned.tag), vec("TV-MANIFEST-01").tag);
    assert.deepEqual(decodeManifest(encodeManifest(c.manifest)), c.manifest);
    assert.deepEqual(decodeSealedManifest(encodeSealedManifest(pinned)), pinned);
    assert.deepEqual(openManifest(pinned, expected).manifest, c.manifest);
    const defaultSealed = sealManifest({ vaultKey, manifest: c.manifest });
    assert.equal(defaultSealed.version, 1);
    assert.deepEqual(verifySnapshotManifest(defaultSealed, c, expected).manifest, c.manifest);
    assert.deepEqual(manifestAad({
      vaultId: C.vault_id, cryptoVersion: 1, revision: C.revision, vaultKeyVersion: VKV,
    }), rawAad("4allpass-manifest-v1", 1));
    const wire = encodeVaultSnapshot(candidate(1).snapshot);
    assert.equal(decodeVaultSnapshot(wire).cryptoProtocolVersion, 1);
    delete wire.sealedManifest;
    assert.equal(decodeVaultSnapshot(wire).sealedManifest, undefined); // Historical v1 legacy path.
  });

  it("rejects v2 at every default-v1 decoder and opener, without header-derived opt-in", () => {
    const c = candidate();
    assert.throws(() => decodeVaultSnapshot(encodeVaultSnapshot(c.snapshot)), ProtocolError);
    assert.throws(() => decodeSealedManifest(encodeSealedManifest(c.sealed)), ProtocolError);
    assert.throws(() => decodeManifest(encodeManifest(c.manifest)), versionRejected);
    assert.throws(() => sealManifest({ vaultKey, manifest: c.manifest }), versionRejected);
    assert.throws(() => openManifest(c.sealed, expected), versionRejected);
    assert.throws(() => verifySnapshotManifest(c.sealed, c, expected), versionRejected);
  });

  it("does not retry v1 when an explicitly v2 caller is served an authentic v1 snapshot", () => {
    const c = candidate(1);
    assert.throws(() => decodeVaultSnapshot(encodeVaultSnapshot(c.snapshot), V2), ProtocolError);
    assert.throws(() => decodeSealedManifest(encodeSealedManifest(c.sealed), V2), ProtocolError);
    assert.throws(() => decodeManifest(encodeManifest(c.manifest), V2), versionRejected);
    assert.throws(() => sealManifest({ vaultKey, manifest: c.manifest, ...V2 }), versionRejected);
    assert.throws(() => openManifest(c.sealed, { ...expected, ...V2 }), versionRejected);
    assert.throws(() => verifySnapshotManifest(c.sealed, c, { ...expected, ...V2 }), versionRejected);
  });

  for (const revision of [1, C.revision]) {
    it(`rejects missing/null v2 manifests even at revision ${revision}`, () => {
      const c = candidate();
      const wire = { ...encodeVaultSnapshot(c.snapshot), revision };
      delete wire.sealedManifest;
      assert.throws(() => decodeVaultSnapshot(wire, V2), ProtocolError);
      assert.throws(() => decodeVaultSnapshot({ ...wire, sealedManifest: null }, V2), ProtocolError);
      assert.throws(() => verifySnapshotManifest(
        undefined as unknown as SealedManifest, c, { ...expected, revision, ...V2 },
      ), ProtocolError);
    });
  }

  it("refuses both outer/sealed version substitutions while encoding remains serialization", () => {
    const v2 = candidate();
    const v1 = candidate(1);
    const mixed2 = encodeVaultSnapshot({ ...v2.snapshot, sealedManifest: v1.sealed });
    const mixed1 = encodeVaultSnapshot({ ...v1.snapshot, sealedManifest: v2.sealed });
    assert.equal(mixed2.cryptoProtocolVersion, 2);
    assert.equal(mixed2.sealedManifest?.version, 1);
    assert.equal(mixed1.cryptoProtocolVersion, 1);
    assert.equal(mixed1.sealedManifest?.version, 2);
    assert.throws(() => decodeVaultSnapshot(mixed2, V2), ProtocolError);
    assert.throws(() => decodeVaultSnapshot(mixed1), ProtocolError);
    assert.throws(() => openManifest({ ...v2.sealed, version: 1 }, { ...expected, ...V2 }), versionRejected);
    assert.throws(() => openManifest({ ...v1.sealed, version: 2 }, expected), versionRejected);
  });

  for (const [label, version] of [
    ["4allpass-manifest-v1", 1],
    ["4allpass-manifest-v1", 2],
    ["4allpass-manifest-v2", 1],
  ] as const) {
    it(`rejects a v2 body sealed with wrong AAD domain/version ${label}/${version}`, () => {
      const c = candidate();
      const sealed = rawSealed(rawBody(c.manifest), rawAad(label, version));
      assert.throws(() => openManifest(sealed, { ...expected, ...V2 }), AuthFailureError);
      assert.throws(() => verifySnapshotManifest(sealed, c, { ...expected, ...V2 }), AuthFailureError);
    });
  }

  for (const [label, version] of [
    ["4allpass-manifest-content-v1", 1],
    ["4allpass-manifest-content-v1", 2],
    ["4allpass-manifest-content-v2", 1],
    ["4allpass-manifest-content-v2", 3],
  ] as const) {
    it(`rejects an authenticated body domain/version mismatch ${label}/${version}`, () => {
      const c = candidate();
      const body = rawBody({ ...c.manifest, cryptoProtocolVersion: version }, label);
      assert.throws(() => decodeManifest(body, V2), versionRejected);
      assert.throws(() => openManifest(rawSealed(body), { ...expected, ...V2 }), versionRejected);
    });
  }

  for (const patch of [
    { vaultId: `${C.vault_id}-foreign` },
    { revision: C.revision + 1 },
    { vaultKeyVersion: VKV + 1 },
  ]) {
    it(`authenticates caller expectations and decrypted body equality for ${Object.keys(patch)[0]}`, () => {
      const c = candidate();
      assert.throws(() => openManifest(c.sealed, { ...expected, ...V2, ...patch }), AuthFailureError);
      assert.throws(() => verifySnapshotManifest(c.sealed, c, { ...expected, ...V2, ...patch }), AuthFailureError);
      const inconsistent = rawSealed(rawBody({ ...c.manifest, ...patch }));
      assert.throws(() => openManifest(inconsistent, { ...expected, ...V2 }), IntegrityError);
    });
  }

  for (const field of ["nonce", "ciphertext", "tag"] as const) {
    it(`rejects a tampered sealed ${field}`, () => {
      const c = candidate();
      assert.throws(() => verifySnapshotManifest(
        { ...c.sealed, [field]: flip(c.sealed[field]) }, c, { ...expected, ...V2 },
      ), AuthFailureError);
    });
  }

  it("still binds the complete entry/envelope sets and every child ciphertext", () => {
    const c = candidate();
    const entry = c.entries[0];
    const envelope = c.envelopes[0];
    assert.ok(entry);
    assert.ok(envelope);
    for (const contents of [
      { entries: [], envelopes: c.envelopes },
      { entries: [...c.entries, { ...entry, id: `${entry.id}-injected` }], envelopes: c.envelopes },
      { entries: [{ ...entry, ciphertext: flip(entry.ciphertext) }], envelopes: c.envelopes },
      { entries: c.entries, envelopes: c.envelopes.slice(1) },
      { entries: c.entries, envelopes: [{ ...envelope, ciphertext: flip(envelope.ciphertext) }, ...c.envelopes.slice(1)] },
    ]) {
      assert.throws(() => verifySnapshotManifest(c.sealed, contents, { ...expected, ...V2 }), IntegrityError);
    }
  });

  for (const childFormat of [2, 3]) {
    it(`rejects child format ${childFormat}; snapshot v2 never upgrades child formats`, () => {
      const c = candidate();
      const wire = encodeVaultSnapshot(c.snapshot);
      const entry = c.entries[0];
      const envelope = c.envelopes[0];
      assert.ok(entry);
      assert.ok(envelope);
      const badEntries = { entries: [{ ...entry, cryptoVersion: childFormat }], envelopes: c.envelopes };
      assert.throws(() => buildManifest({ ...expected, ...badEntries, ...V2 }), ProtocolError);
      assert.throws(() => verifySnapshotManifest(c.sealed, badEntries, { ...expected, ...V2 }), IntegrityError);
      assert.throws(() => decodeVaultSnapshot({
        ...wire, entries: wire.entries.map((e) => ({ ...e, cryptoVersion: childFormat })),
      }, V2), ProtocolError);
      assert.throws(() => decodeVaultSnapshot({
        ...wire, envelopes: wire.envelopes.map((e) => ({ ...e, version: childFormat })),
      }, V2), ProtocolError);
      const contents = { entries: c.entries, envelopes: [{ ...envelope, version: childFormat }, ...c.envelopes.slice(1)] };
      assert.throws(() => buildManifest({ ...expected, ...contents, ...V2 }), ProtocolError);
      assert.throws(() => verifySnapshotManifest(c.sealed, contents, { ...expected, ...V2 }), IntegrityError);
      const body = rawBody({ ...c.manifest, entries: c.manifest.entries.map((e) => ({ ...e, cryptoVersion: childFormat })) });
      assert.throws(() => decodeManifest(body, V2), ProtocolError);
      assert.throws(() => openManifest(rawSealed(body), { ...expected, ...V2 }), ProtocolError);
    });
  }

  it("rejects null caller versions instead of silently accepting valid v1 data", () => {
    const c = candidate(1);
    const opts = { cryptoProtocolVersion: null as unknown as number };
    assert.throws(() => buildManifest({ ...expected, ...c, ...opts }), ProtocolError);
    assert.throws(() => sealManifest({ vaultKey, manifest: c.manifest, ...opts }), ProtocolError);
    assert.throws(() => openManifest(c.sealed, { ...expected, ...opts }), ProtocolError);
    assert.throws(() => verifySnapshotManifest(c.sealed, c, { ...expected, ...opts }), ProtocolError);
    assert.throws(() => decodeManifest(encodeManifest(c.manifest), opts), ProtocolError);
    assert.throws(() => decodeSealedManifest(encodeSealedManifest(c.sealed), opts), ProtocolError);
    assert.throws(() => decodeVaultSnapshot(encodeVaultSnapshot(c.snapshot), opts), ProtocolError);
  });

  it("reads the caller version once and refuses v1 under its original v2 expectation", () => {
    const c = candidate(1);
    function options() {
      let reads = 0;
      return {
        value: {
          ...expected,
          get cryptoProtocolVersion() { return ++reads === 1 ? 2 : 1; },
        },
        reads: () => reads,
      };
    }
    const checks: Array<(opts: ReturnType<typeof options>["value"]) => unknown> = [
      (opts) => sealManifest(Object.assign(opts, { manifest: c.manifest })),
      (opts) => openManifest(c.sealed, opts),
      (opts) => verifySnapshotManifest(c.sealed, c, opts),
      (opts) => decodeManifest(encodeManifest(c.manifest), opts),
      (opts) => decodeSealedManifest(encodeSealedManifest(c.sealed), opts),
      (opts) => decodeVaultSnapshot(encodeVaultSnapshot(c.snapshot), opts),
    ];
    for (const check of checks) {
      const request = options();
      assert.throws(() => check(request.value), versionRejected);
      assert.equal(request.reads(), 1);
    }
    const request = options();
    const built = buildManifest(Object.assign(request.value, {
      entries: c.entries, envelopes: c.envelopes,
    }));
    assert.equal(built.cryptoProtocolVersion, 2);
    assert.equal(request.reads(), 1);
  });

  for (const unsupported of [0, 3, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32]) {
    it(`rejects unsupported protocol ${String(unsupported)} rather than coercing/defaulting`, () => {
      const c = candidate();
      const opts = { cryptoProtocolVersion: unsupported };
      assert.throws(() => buildManifest({ ...expected, ...c, ...opts }), ProtocolError);
      assert.throws(() => sealManifest({ vaultKey, manifest: c.manifest, ...opts }), ProtocolError);
      assert.throws(() => openManifest(c.sealed, { ...expected, ...opts }), ProtocolError);
      assert.throws(() => verifySnapshotManifest(c.sealed, c, { ...expected, ...opts }), ProtocolError);
      assert.throws(() => decodeManifest(encodeManifest(c.manifest), opts), ProtocolError);
      assert.throws(() => decodeSealedManifest(encodeSealedManifest(c.sealed), opts), ProtocolError);
      assert.throws(() => decodeVaultSnapshot(encodeVaultSnapshot(c.snapshot), opts), ProtocolError);
      assert.throws(() => decodeVaultSnapshot({ ...encodeVaultSnapshot(c.snapshot), cryptoProtocolVersion: unsupported }, V2), ProtocolError);
      assert.throws(() => decodeSealedManifest({ ...encodeSealedManifest(c.sealed), version: unsupported }, V2), ProtocolError);
      assert.throws(() => openManifest({ ...c.sealed, version: unsupported }, { ...expected, ...V2 }), ProtocolError);
    });
  }
});
