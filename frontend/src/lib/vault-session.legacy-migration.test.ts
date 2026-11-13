/** G1: explicit legacy manifest migration; no automatic path, no lost-POST retry. */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  IntegrityError,
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
  type WireVaultSnapshot,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { loadMigrationAttempt } from "./migration-attempt.ts";
import { loadPin } from "./revision-pin.ts";
import { memorySnapshotCache, setSnapshotCacheForTests, type SnapshotCache } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { VaultLockedError } from "./vault-liveness.ts";
import {
  commitEntries,
  isLegacyVault,
  LegacyMigrationError,
  migrateLegacySnapshot,
  unlockWithRecoveryKey,
} from "./vault-session.ts";

const originalGet = api.getSnapshot.bind(api);
const originalCommit = api.commitSnapshot.bind(api);
afterEach(() => {
  api.getSnapshot = originalGet;
  api.commitSnapshot = originalCommit;
  setSnapshotCacheForTests(null);
  clearTestStorage();
});

function fixture(vaultId: string) {
  const vaultKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const recovery = wrapVaultKey({
    vaultKey, wrappingKey, vaultId, type: "recovery", vaultKeyVersion: 1,
  });
  const shareKey = formatRecoveryKey(recoveryKey);

  function snapshot(revision: number, manifest: boolean, title = "Synthetic title") {
    const item: VaultEntry = {
      ...emptyDraft(),
      id: "entry-1",
      title,
      username: "synthetic",
      password: "dummy-only",
      updatedAt: "2026-11-10T00:00:00Z",
    };
    const plaintext = encodeEntryPlaintext(item);
    const entry = encryptEntry({
      vaultKey, vaultId, entryId: item.id, vaultKeyVersion: 1, schemaVersion: 1, plaintext,
    });
    zeroize(plaintext);
    const secondItem: VaultEntry = { ...item, id: "entry-2", title: "Second title" };
    const secondPlaintext = encodeEntryPlaintext(secondItem);
    const secondEntry = encryptEntry({
      vaultKey, vaultId, entryId: secondItem.id, vaultKeyVersion: 1, schemaVersion: 1,
      plaintext: secondPlaintext,
    });
    zeroize(secondPlaintext);
    const entries = [entry, secondEntry];
    const envelopes = [recovery];
    const sealed = manifest
      ? sealManifest({
          vaultKey,
          manifest: buildManifest({ vaultId, revision, vaultKeyVersion: 1, entries, envelopes }),
        })
      : undefined;
    const wire = encodeVaultSnapshot({
      vaultId, revision, vaultKeyVersion: 1, cryptoProtocolVersion: 1, entries, envelopes,
      ...(sealed ? { sealedManifest: sealed } : {}),
    });
    const pin: VaultRevision = {
      vaultId, revision, vaultKeyVersion: 1, cryptoProtocolVersion: 1,
      ...(sealed ? { manifestDigest: sealedManifestDigest(sealed) } : {}),
    };
    return { wire, pin };
  }

  return {
    shareKey,
    snapshot,
    dispose: () => zeroize(vaultKey, recoveryKey, wrappingKey),
  };
}

async function openLegacy(vaultId: string, f: ReturnType<typeof fixture>) {
  const legacy = f.snapshot(1, false);
  api.getSnapshot = async () => legacy.wire;
  const vault = await unlockWithRecoveryKey(vaultId, f.shareKey);
  assert.equal(vault.unlockedWith, "recovery_key");
  assert.equal(isLegacyVault(vault), true);
  return vault;
}

test("MIG-1 explicit confirm performs a forward manifest commit and pins it", async () => {
  const vaultId = "legacy-mig-1";
  const f = fixture(vaultId);
  const cache = memorySnapshotCache();
  setSnapshotCacheForTests(cache);
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    let sent: Record<string, unknown> | null = null;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      sent = payload as unknown as Record<string, unknown>;
      // The legacy wire must already be the durable local backup.
      const backup = await cache.load(id);
      assert.equal(backup?.revision, 1);
      assert.equal(backup?.sealedManifest, undefined);
      return { ...payload, vaultId: id };
    };
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    if (outcome.status !== "migrated") return;
    assert.equal(posts, 1);
    assert.ok(sent?.sealedManifest);
    assert.equal(outcome.vault.revision, 2);
    assert.equal(outcome.vault.entries[0]?.id, vault.entries[0]?.id);
    assert.equal(outcome.vault.entries[0]?.title, vault.entries[0]?.title);
    const pin = loadPin(vaultId);
    assert.equal(pin?.revision, 2);
    assert.ok(pin?.manifestDigest);
    assert.equal((await cache.load(vaultId))?.revision, 2);
    assert.equal((await cache.loadLegacyBackup(vaultId))?.revision, 1);
    if (sent) {
      api.getSnapshot = async () => ({ ...(sent as Record<string, unknown>), vaultId } as never);
      const reopened = await unlockWithRecoveryKey(vaultId, f.shareKey);
      assert.equal(reopened.revision, 2);
      assert.equal(reopened.entries.length, 2);
      zeroize(reopened.vaultKey);
    }
    zeroize(outcome.vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-2 default/decline never commits", async () => {
  const vaultId = "legacy-mig-2";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      return { ...payload, vaultId: id };
    };
    const outcome = await migrateLegacySnapshot(vault, { confirmed: false });
    assert.equal(outcome.status, "declined");
    assert.equal(posts, 0);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-3 backup failure stops before any POST", async () => {
  const vaultId = "legacy-mig-3";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      return { ...payload, vaultId: id };
    };
    const failing: SnapshotCache = {
      load: async () => null,
      save: async () => { throw new Error("local storage unavailable"); },
      remove: async () => undefined,
      loadLegacyBackup: async () => null,
      saveLegacyBackup: async () => { throw new Error("local storage unavailable"); },
      removeLegacyBackup: async () => undefined,
    };
    setSnapshotCacheForTests(failing);
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true }),
      (error: unknown) => error instanceof LegacyMigrationError && error.code === "legacy_backup_failed",
    );
    assert.equal(posts, 0);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-4 lost response with a legacy head is UNKNOWN and posts no second time", async () => {
  const vaultId = "legacy-mig-4";
  const f = fixture(vaultId);
  const legacy = f.snapshot(1, false);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async () => {
      posts++;
      throw new TypeError("network closed after send");
    };
    // The head still looks legacy. That proves nothing about acceptance.
    api.getSnapshot = async () => legacy.wire;
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "unknown");
    assert.equal(posts, 1);
    assert.equal(loadPin(vaultId)?.revision, 1);
    assert.equal(loadMigrationAttempt(vaultId)?.state, "unknown");
    const second = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(second.status, "retry_blocked");
    assert.equal(posts, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-4b lost response with the exact prepared head is success", async () => {
  const vaultId = "legacy-mig-4b";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let prepared: Record<string, unknown> | null = null;
    let posts = 0;
    api.commitSnapshot = async (_id, payload) => {
      posts++;
      prepared = payload as unknown as Record<string, unknown>;
      throw new TypeError("network closed after send");
    };
    api.getSnapshot = async () => ({ ...prepared, vaultId } as never);
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    assert.equal(posts, 1);
    if (outcome.status === "migrated") {
      assert.equal(outcome.vault.revision, 2);
      assert.equal(loadPin(vaultId)?.revision, 2);
      zeroize(outcome.vault.vaultKey);
    }
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-5 409 adopts the verified winner without overlay or a second POST", async () => {
  const vaultId = "legacy-mig-5";
  const f = fixture(vaultId);
  const winner = f.snapshot(2, true, "Winner title");
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async () => {
      posts++;
      throw new ApiError(409, { currentRevision: 2 });
    };
    api.getSnapshot = async () => winner.wire;
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "conflict");
    assert.equal(posts, 1);
    assert.ok(outcome.status === "conflict" && outcome.vault);
    if (outcome.status === "conflict" && outcome.vault) {
      assert.ok(outcome.vault.entries.some((entry) => entry.title === "Winner title"));
      assert.equal(loadPin(vaultId)?.revision, 2);
      zeroize(outcome.vault.vaultKey);
    }
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-6 a concurrent device wins; the loser reloads and does not overlay", async () => {
  const vaultId = "legacy-mig-6";
  const f = fixture(vaultId);
  const winner = f.snapshot(2, true, "Other device title");
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async () => {
      posts++;
      throw new ApiError(409, { currentRevision: 2 });
    };
    api.getSnapshot = async () => winner.wire;
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "conflict");
    assert.equal(posts, 1);
    if (outcome.status === "conflict" && outcome.vault) {
      assert.ok(outcome.vault.entries.some((entry) => entry.title === "Other device title"));
      zeroize(outcome.vault.vaultKey);
    }
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-7 recovery-key unlock uses the same opt-in migration path", async () => {
  const vaultId = "legacy-mig-7";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    assert.equal(vault.unlockedWith, "recovery_key");
    api.commitSnapshot = async (id, payload) => ({ ...payload, vaultId: id });
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    if (outcome.status === "migrated") zeroize(outcome.vault.vaultKey);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-8 a legacy first write/import seals a manifest (implicit migration)", async () => {
  const vaultId = "legacy-mig-8";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let sent: Record<string, unknown> | null = null;
    api.commitSnapshot = async (id, payload) => {
      sent = payload as unknown as Record<string, unknown>;
      return { ...payload, vaultId: id };
    };
    const next = await commitEntries(vault, vault.entries);
    assert.equal(next.revision, 2);
    assert.ok(sent?.sealedManifest);
    assert.ok(loadPin(vaultId)?.manifestDigest);
    zeroize(next.vaultKey);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-15 migration keeps the complete opened entry/envelope set", async () => {
  const vaultId = "legacy-mig-15";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    const beforeEntries = vault.entries.map((entry) => ({ id: entry.id, title: entry.title }));
    assert.equal(beforeEntries.length, 2);
    const beforeEnvelopes = vault.envelopes.map((envelope) => `${envelope.type}:${envelope.deviceId ?? ""}`);
    api.commitSnapshot = async (id, payload) => ({ ...payload, vaultId: id });
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    if (outcome.status === "migrated") {
      assert.deepEqual(
        outcome.vault.entries.map((entry) => ({ id: entry.id, title: entry.title })),
        beforeEntries,
      );
      assert.deepEqual(
        outcome.vault.envelopes.map((envelope) => `${envelope.type}:${envelope.deviceId ?? ""}`),
        beforeEnvelopes,
      );
      zeroize(outcome.vault.vaultKey);
    }
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-16a same entry id with a changed payload stops before any POST", async () => {
  const vaultId = "legacy-mig-16a";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    vault.entries[0]!.title = "Tampered title";
    let posts = 0;
    api.commitSnapshot = async (id, payload) => { posts++; return { ...payload, vaultId: id }; };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true }),
      (error: unknown) => error instanceof LegacyMigrationError && error.code === "legacy_accepted_state_changed",
    );
    assert.equal(posts, 0);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-16b same envelope identity with changed bytes stops before any POST", async () => {
  const vaultId = "legacy-mig-16b";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    (vault.envelopes[0] as unknown as { nonce: Uint8Array }).nonce = new Uint8Array(12);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => { posts++; return { ...payload, vaultId: id }; };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true }),
      (error: unknown) => error instanceof LegacyMigrationError && error.code === "legacy_accepted_state_changed",
    );
    assert.equal(posts, 0);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-16c changed wire metadata stops before any POST", async () => {
  const vaultId = "legacy-mig-16c";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    (vault.wire as unknown as { vaultKeyVersion: number }).vaultKeyVersion = 2;
    let posts = 0;
    api.commitSnapshot = async (id, payload) => { posts++; return { ...payload, vaultId: id }; };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true }),
      (error: unknown) => error instanceof LegacyMigrationError && error.code === "legacy_wire_mismatch",
    );
    assert.equal(posts, 0);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-17 a lock during the legacy backup await aborts before any POST", async () => {
  const vaultId = "legacy-mig-17";
  const f = fixture(vaultId);
  const base = memorySnapshotCache();
  let live = true;
  const cache: SnapshotCache = {
    load: (id) => base.load(id),
    save: (id, snapshot) => base.save(id, snapshot),
    remove: (id) => base.remove(id),
    loadLegacyBackup: (id) => base.loadLegacyBackup(id),
    removeLegacyBackup: (id) => base.removeLegacyBackup(id),
    saveLegacyBackup: async (id, snapshot) => {
      await base.saveLegacyBackup(id, snapshot);
      live = false;
    },
  };
  setSnapshotCacheForTests(cache);
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => { posts++; return { ...payload, vaultId: id }; };
    const liveness = {
      epoch: 0,
      isLive: () => live,
      assertLive: () => { if (!live) throw new VaultLockedError(); },
    };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true, liveness }),
      VaultLockedError,
    );
    assert.equal(posts, 0);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-18 a lock during acceptSnapshot cache await discards the opened key", async () => {
  const vaultId = "legacy-mig-18";
  const f = fixture(vaultId);
  const base = memorySnapshotCache();
  let live = true;
  const cache: SnapshotCache = {
    load: (id) => base.load(id),
    save: async (id, snapshot) => {
      await base.save(id, snapshot);
      live = false;
    },
    remove: (id) => base.remove(id),
    loadLegacyBackup: (id) => base.loadLegacyBackup(id),
    saveLegacyBackup: (id, snapshot) => base.saveLegacyBackup(id, snapshot),
    removeLegacyBackup: (id) => base.removeLegacyBackup(id),
  };
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    setSnapshotCacheForTests(cache);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => { posts++; return { ...payload, vaultId: id }; };
    const liveness = {
      epoch: 0,
      isLive: () => live,
      assertLive: () => { if (!live) throw new VaultLockedError(); },
    };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true, liveness }),
      VaultLockedError,
    );
    assert.equal(posts, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

function persistentCache(records: Map<string, WireVaultSnapshot>): SnapshotCache {
  const head = (vaultId: string) => `head:${vaultId}`;
  const legacy = (vaultId: string) => `legacy:${vaultId}`;
  return {
    async load(vaultId) { return records.get(head(vaultId)) ?? null; },
    async save(vaultId, snapshot) { records.set(head(vaultId), snapshot); },
    async remove(vaultId) { records.delete(head(vaultId)); records.delete(legacy(vaultId)); },
    async loadLegacyBackup(vaultId) { return records.get(legacy(vaultId)) ?? null; },
    async saveLegacyBackup(vaultId, snapshot) { records.set(legacy(vaultId), snapshot); },
    async removeLegacyBackup(vaultId) { records.delete(legacy(vaultId)); },
  };
}

test("MIG-20 legacy backup survives the head switch and a new cache instance", async () => {
  const vaultId = "legacy-mig-20";
  const f = fixture(vaultId);
  const records = new Map<string, WireVaultSnapshot>();
  setSnapshotCacheForTests(persistentCache(records));
  try {
    const vault = await openLegacy(vaultId, f);
    api.commitSnapshot = async (id, payload) => ({ ...payload, vaultId: id });
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    if (outcome.status === "migrated") zeroize(outcome.vault.vaultKey);
    zeroize(vault.vaultKey);
    // A new app instance/cache view over the same persistent records.
    const reloaded = persistentCache(records);
    setSnapshotCacheForTests(reloaded);
    assert.equal((await reloaded.loadLegacyBackup(vaultId))?.revision, 1);
    assert.equal((await reloaded.load(vaultId))?.revision, 2);
  } finally {
    f.dispose();
  }
});

test("MIG-19 simultaneous same-vault clicks start only one attempt", async () => {
  const vaultId = "legacy-mig-19";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    let release: (() => void) | null = null;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      return new Promise((resolve) => {
        release = () => resolve({ ...payload, vaultId: id });
      });
    };
    const first = migrateLegacySnapshot(vault, { confirmed: true });
    const second = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(second.status, "retry_blocked");
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    release!();
    const outcome = await first;
    assert.equal(outcome.status, "migrated");
    assert.equal(posts, 1);
    if (outcome.status === "migrated") zeroize(outcome.vault.vaultKey);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-9 offline/lost GET stays UNKNOWN with no further POST", async () => {
  const vaultId = "legacy-mig-9";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async () => {
      posts++;
      throw new TypeError("offline");
    };
    api.getSnapshot = async () => { throw new TypeError("offline"); };
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "unknown");
    assert.equal(posts, 1);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-10 lock before sealing aborts before any POST", async () => {
  const vaultId = "legacy-mig-10";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      return { ...payload, vaultId: id };
    };
    const locked = {
      epoch: 0,
      isLive: () => false,
      assertLive: () => { throw new VaultLockedError(); },
    };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true, liveness: locked }),
      VaultLockedError,
    );
    assert.equal(posts, 0);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-11 lock during the response is not adopted", async () => {
  const vaultId = "legacy-mig-11";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let live = true;
    let posts = 0;
    api.commitSnapshot = async (id, payload) => {
      posts++;
      live = false;
      return { ...payload, vaultId: id };
    };
    const liveness = {
      epoch: 0,
      isLive: () => live,
      assertLive: () => { if (!live) throw new VaultLockedError(); },
    };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true, liveness }),
      VaultLockedError,
    );
    assert.equal(posts, 1);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-12 a definite 4xx rejection is a protocol error, never a retry", async () => {
  const vaultId = "legacy-mig-12";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    let posts = 0;
    api.commitSnapshot = async () => {
      posts++;
      throw new ApiError(422, { detail: "sealedManifest is required" });
    };
    await assert.rejects(
      () => migrateLegacySnapshot(vault, { confirmed: true }),
      (error: unknown) => error instanceof LegacyMigrationError && error.code === "legacy_migration_rejected",
    );
    assert.equal(posts, 1);
    assert.equal(loadPin(vaultId)?.revision, 1);
    zeroize(vault.vaultKey);
  } finally {
    f.dispose();
  }
});

test("MIG-13 a manifestless head after a digest pin is rejected", async () => {
  const vaultId = "legacy-mig-13";
  const f = fixture(vaultId);
  setSnapshotCacheForTests(memorySnapshotCache());
  try {
    const vault = await openLegacy(vaultId, f);
    api.commitSnapshot = async (id, payload) => ({ ...payload, vaultId: id });
    const outcome = await migrateLegacySnapshot(vault, { confirmed: true });
    assert.equal(outcome.status, "migrated");
    if (outcome.status === "migrated") zeroize(outcome.vault.vaultKey);
    zeroize(vault.vaultKey);
    const pin = loadPin(vaultId);
    assert.ok(pin?.manifestDigest);
    // A later manifestless state must not be accepted after that digest pin.
    api.getSnapshot = async () => f.snapshot(3, false).wire;
    await assert.rejects(() => unlockWithRecoveryKey(vaultId, f.shareKey), IntegrityError);
  } finally {
    f.dispose();
  }
});
