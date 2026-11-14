import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  REVISION_MAX,
  RollbackError,
  assertFreshSnapshot,
  buildManifest,
  encryptEntry,
  evaluateRevision,
  generateVaultKey,
  openManifest,
  revisionFromManifest,
  sealManifest,
  verifySnapshotManifest,
  wrapVaultKey,
  type VaultRevision,
} from "../src/index.ts";
import { C, VKV, deviceKey, fixtureSnapshot, vaultKey } from "./fixtures.ts";

function snapshotAt(revision: number, vaultKeyVersion = VKV) {
  const base = fixtureSnapshot();
  const entries = base.entries.map((entry) =>
    encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: entry.id,
      vaultKeyVersion,
      plaintext: new TextEncoder().encode(`{"revision":${revision}}`),
    }),
  );
  const envelopes = [
    wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: C.vault_id,
      type: "device",
      vaultKeyVersion,
      deviceId: C.device_id,
      deviceKeyVersion: 1,
    }),
  ];
  const manifest = buildManifest({
    vaultId: C.vault_id,
    revision,
    vaultKeyVersion,
    entries,
    envelopes,
  });
  const sealed = sealManifest({ vaultKey, manifest });
  const verified = openManifest(sealed, {
    vaultKey,
    vaultId: C.vault_id,
    revision,
    vaultKeyVersion,
  });
  return { entries, envelopes, manifest, sealed, verified };
}

const pin: VaultRevision = {
  vaultId: C.vault_id,
  revision: 10,
  vaultKeyVersion: 2,
  cryptoProtocolVersion: 1,
};

describe("attack: revision rollback", () => {
  it("refuses a replayed older revision", () => {
    const decision = evaluateRevision(pin, { ...pin, revision: 7 });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.action, "rollback");
      assert.ok(decision.error instanceof RollbackError);
    }
  });

  it("refuses a manifest replayed under a newer revision number", () => {
    const older = snapshotAt(41);
    assert.throws(
      () =>
        openManifest(older.sealed, {
          vaultKey,
          vaultId: C.vault_id,
          revision: 42,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("refuses entries from an older snapshot mixed into the current revision", () => {
    const current = snapshotAt(42);
    const older = snapshotAt(41);
    assert.throws(
      () =>
        verifySnapshotManifest(
          current.sealed,
          { entries: older.entries, envelopes: current.envelopes },
          { vaultKey, vaultId: C.vault_id, revision: 42, vaultKeyVersion: VKV },
        ),
      IntegrityError,
    );
  });

  it("refuses a revoked device envelope re-attached to a later snapshot", () => {
    const current = snapshotAt(42);
    const revoked = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: C.vault_id,
      type: "device",
      vaultKeyVersion: VKV,
      deviceId: "dev_revoked_laptop",
      deviceKeyVersion: 1,
    });
    assert.throws(
      () =>
        verifySnapshotManifest(
          current.sealed,
          { entries: current.entries, envelopes: [...current.envelopes, revoked] },
          { vaultKey, vaultId: C.vault_id, revision: 42, vaultKeyVersion: VKV },
        ),
      IntegrityError,
    );
  });

  it("detects a server that serves two different snapshots for one revision", () => {
    const first = snapshotAt(42);
    const second = snapshotAt(42);
    const pinnedFirst = revisionFromManifest(first.verified);
    const pinnedSecond = revisionFromManifest(second.verified);
    const decision = evaluateRevision(pinnedFirst, pinnedSecond);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.action, "mismatch");
      assert.match(decision.error.message, /equivocation/);
    }
    assert.equal(evaluateRevision(pinnedFirst, { ...pinnedFirst }).ok, true);
  });

  it("refuses to drop the manifest check once a revision was pinned with one", () => {
    const current = snapshotAt(42);
    const pinned = revisionFromManifest(current.verified);
    const withoutDigest: VaultRevision = {
      vaultId: pinned.vaultId,
      revision: pinned.revision,
      vaultKeyVersion: pinned.vaultKeyVersion,
      cryptoProtocolVersion: pinned.cryptoProtocolVersion,
    };
    const decision = evaluateRevision(pinned, withoutDigest);
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.action, "mismatch");
  });

  it("refuses a higher-revision snapshot that omits the manifest after a digest pin", () => {
    const pinned = revisionFromManifest(snapshotAt(2).verified);
    const withoutDigest: VaultRevision = {
      vaultId: pinned.vaultId,
      revision: 3,
      vaultKeyVersion: pinned.vaultKeyVersion,
      cryptoProtocolVersion: pinned.cryptoProtocolVersion,
    };
    const decision = evaluateRevision(pinned, withoutDigest);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.action, "mismatch");
      assert.ok(decision.error instanceof IntegrityError);
    }
    assert.throws(() => assertFreshSnapshot(pinned, withoutDigest), IntegrityError);
  });

  it("accepts an honest advance that carries a new manifest digest", () => {
    const first = snapshotAt(42);
    const next = snapshotAt(43);
    const decision = evaluateRevision(
      revisionFromManifest(first.verified),
      revisionFromManifest(next.verified),
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.action, "advance");
  });

  it("refuses a pin poisoned beyond the uint32 revision range", () => {
    assert.throws(
      () => assertFreshSnapshot(null, { ...pin, revision: REVISION_MAX + 1 }),
      ProtocolError,
    );
    assert.throws(
      () => assertFreshSnapshot(null, { ...pin, revision: Number.MAX_SAFE_INTEGER }),
      ProtocolError,
    );
  });
});

describe("attack: snapshot truncation and injection", () => {
  it("refuses a snapshot with an entry silently dropped", () => {
    const current = snapshotAt(42);
    const extra = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_second",
      vaultKeyVersion: VKV,
      plaintext: new TextEncoder().encode("{}"),
    });
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: 42,
      vaultKeyVersion: VKV,
      entries: [...current.entries, extra],
      envelopes: current.envelopes,
    });
    const sealed = sealManifest({ vaultKey, manifest });
    assert.throws(
      () =>
        verifySnapshotManifest(
          sealed,
          { entries: current.entries, envelopes: current.envelopes },
          { vaultKey, vaultId: C.vault_id, revision: 42, vaultKeyVersion: VKV },
        ),
      IntegrityError,
    );
  });

  it("refuses an entry injected into a verified snapshot", () => {
    const current = snapshotAt(42);
    const injected = encryptEntry({
      vaultKey,
      vaultId: C.vault_id,
      entryId: "entry_injected",
      vaultKeyVersion: VKV,
      plaintext: new TextEncoder().encode('{"password":"attacker"}'),
    });
    assert.throws(
      () =>
        verifySnapshotManifest(
          current.sealed,
          { entries: [...current.entries, injected], envelopes: current.envelopes },
          { vaultKey, vaultId: C.vault_id, revision: 42, vaultKeyVersion: VKV },
        ),
      IntegrityError,
    );
  });

  it("refuses a duplicated entry id", () => {
    const current = snapshotAt(42);
    const first = current.entries[0];
    assert.ok(first);
    assert.throws(
      () =>
        buildManifest({
          vaultId: C.vault_id,
          revision: 42,
          vaultKeyVersion: VKV,
          entries: [first, first],
          envelopes: current.envelopes,
        }),
      ProtocolError,
    );
  });

  it("refuses two envelopes for the same device", () => {
    const current = snapshotAt(42);
    const first = current.envelopes[0];
    assert.ok(first);
    assert.throws(
      () =>
        buildManifest({
          vaultId: C.vault_id,
          revision: 42,
          vaultKeyVersion: VKV,
          entries: current.entries,
          envelopes: [first, first],
        }),
      ProtocolError,
    );
  });
});

describe("attack: key-generation downgrade", () => {
  it("refuses a vaultKeyVersion that goes backwards", () => {
    const decision = evaluateRevision(pin, { ...pin, revision: 11, vaultKeyVersion: 1 });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.action, "downgrade");
      assert.ok(decision.error instanceof IntegrityError);
    }
  });

  it("refuses a protocol version outside the range this client implements", () => {
    for (const cryptoProtocolVersion of [0, 2, -1]) {
      assert.throws(
        () => assertFreshSnapshot(pin, { ...pin, revision: 11, cryptoProtocolVersion }),
        ProtocolError,
      );
    }
  });

  it("refuses to reason about a pin written by a newer client", () => {
    const pinFromNewerClient: VaultRevision = { ...pin, cryptoProtocolVersion: 2 };
    assert.throws(() => assertFreshSnapshot(pinFromNewerClient, { ...pin, revision: 11 }), ProtocolError);
  });

  it("refuses a manifest replayed under another vault key generation", () => {
    const current = snapshotAt(42, VKV);
    assert.throws(
      () =>
        openManifest(current.sealed, {
          vaultKey,
          vaultId: C.vault_id,
          revision: 42,
          vaultKeyVersion: VKV + 1,
        }),
      AuthFailureError,
    );
  });

  it("refuses a manifest for another vault", () => {
    const current = snapshotAt(42);
    assert.throws(
      () =>
        openManifest(current.sealed, {
          vaultKey,
          vaultId: "vault_01HZX4ALLPASS000000000002",
          revision: 42,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("accepts an honest advance and an honest rotation", () => {
    assert.equal(assertFreshSnapshot(pin, { ...pin, revision: 11 }), "advance");
    assert.equal(
      assertFreshSnapshot(pin, { ...pin, revision: 11, vaultKeyVersion: 3 }),
      "rotation",
    );
  });

  it("pins only what the manifest proves", () => {
    const current = snapshotAt(42);
    const pinned = revisionFromManifest(current.verified);
    assert.equal(pinned.revision, 42);
    assert.equal(pinned.vaultKeyVersion, VKV);
    assert.equal(pinned.manifestDigest?.length, 32);
    assert.throws(
      () =>
        openManifest(current.sealed, {
          vaultKey: generateVaultKey(),
          vaultId: C.vault_id,
          revision: 42,
          vaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });
});

describe("explicit v2 revision pins without protocol migration", () => {
  const v2 = { cryptoProtocolVersion: 2 };

  function verifiedV2(revision = 42) {
    const { entries, envelopes } = fixtureSnapshot();
    const manifest = buildManifest({
      vaultId: C.vault_id, revision, vaultKeyVersion: VKV,
      entries, envelopes, allowTestProfile: true, ...v2,
    });
    return verifySnapshotManifest(sealManifest({ vaultKey, manifest, ...v2 }), { entries, envelopes }, {
      vaultKey, vaultId: C.vault_id, revision, vaultKeyVersion: VKV,
      allowTestProfile: true, ...v2,
    });
  }

  it("pins the authenticated v2 version and exact sealed digest only with explicit opt-in", () => {
    const verified = verifiedV2();
    assert.throws(() => revisionFromManifest(verified), ProtocolError);
    const accepted = revisionFromManifest(verified, v2);
    assert.equal(accepted.cryptoProtocolVersion, 2);
    assert.deepEqual(accepted.manifestDigest, verified.sealedDigest);
    assert.throws(() => assertFreshSnapshot(null, accepted), ProtocolError);
    assert.equal(assertFreshSnapshot(null, accepted, v2), "first_seen");
    assert.equal(assertFreshSnapshot(accepted, { ...accepted }, v2), "same");
    const next = revisionFromManifest(verifiedV2(43), v2);
    assert.equal(assertFreshSnapshot(accepted, next, v2), "advance");
    assert.equal(assertFreshSnapshot(next, { ...next, revision: 44, vaultKeyVersion: VKV + 1 }, v2), "rotation");
    assert.throws(() => assertFreshSnapshot(next, accepted, v2), RollbackError);
    assert.throws(() => assertFreshSnapshot(accepted, {
      ...accepted, manifestDigest: new Uint8Array(32).fill(99),
    }, v2), IntegrityError);
  });

  it("never changes an existing pin's protocol, even with higher revision/generation", () => {
    const two = revisionFromManifest(verifiedV2(), v2);
    const one = { ...two, cryptoProtocolVersion: 1 };
    assert.throws(() => assertFreshSnapshot(one, {
      ...two, revision: 100, vaultKeyVersion: VKV + 1,
    }, v2), IntegrityError);
    assert.throws(() => assertFreshSnapshot(two, {
      ...one, revision: 100, vaultKeyVersion: VKV + 1,
    }), ProtocolError);
    assert.throws(() => assertFreshSnapshot(two, {
      ...one, revision: 100, vaultKeyVersion: VKV + 1,
    }, v2), ProtocolError);
  });

  it("requires a 32-byte v2 digest, retaining digestless v1 compatibility", () => {
    const two = revisionFromManifest(verifiedV2(), v2);
    const { manifestDigest: _digest, ...withoutDigest } = two;
    for (const malformed of [withoutDigest, { ...two, manifestDigest: new Uint8Array(0) }, { ...two, manifestDigest: new Uint8Array(31) }]) {
      assert.throws(() => assertFreshSnapshot(null, malformed, v2), ProtocolError);
    }
    assert.equal(assertFreshSnapshot(null, pin), "first_seen");
    assert.throws(() => assertFreshSnapshot(null, { ...pin, manifestDigest: new Uint8Array(31) }), ProtocolError);
    assert.throws(() => revisionFromManifest({ ...verifiedV2(), sealedDigest: new Uint8Array(31) }, v2), ProtocolError);
  });

  it("rejects unsupported expectations and versions rather than guessing from metadata", () => {
    const verified = verifiedV2();
    const two = { ...pin, ...v2, manifestDigest: verified.sealedDigest };
    for (const unsupported of [0, 3, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const options = { cryptoProtocolVersion: unsupported };
      assert.throws(() => evaluateRevision(null, two, options), ProtocolError);
      assert.throws(() => revisionFromManifest(verified, options), ProtocolError);
      assert.throws(() => assertFreshSnapshot(null, { ...two, cryptoProtocolVersion: unsupported }, v2), ProtocolError);
      assert.throws(() => revisionFromManifest({
        ...verified, manifest: { ...verified.manifest, cryptoProtocolVersion: unsupported },
      }, v2), ProtocolError);
    }
    assert.throws(() => revisionFromManifest(snapshotAt(42).verified, v2), ProtocolError);
  });
});
