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
  verifySnapshot,
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
        verifySnapshot(
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
        verifySnapshot(
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
        verifySnapshot(
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
        verifySnapshot(
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
