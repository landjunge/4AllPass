/**
 * Single-entry restore (P0 #279, "Papierkorb" preparation).
 *
 * Two layers are covered:
 * - `resolveSingleEntryRestore`: real crypto roundtrips with a stubbed server.
 * - `restoreEntry`: the lifecycle orchestration (liveness binding, deferred
 *   fetch, cancel, commit/wipe) with injected dependencies, in the same shape
 *   as vault-lifecycle/tests/pull-local-lock.test.ts.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  bytesToBase64,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  sealedManifestDigest,
  wrapVaultKey,
  zeroize,
  type EncryptedEntry,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import {
  EntryAlreadyPresentError,
  resolveSingleEntryRestore,
  restoreEntry,
  type RestoreEntryDependencies,
} from "./entry-restore.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { captureVaultLiveness, VaultLockedError } from "./vault-liveness.ts";
import { runWithStatus, type FeedbackAction } from "../modules/feedback/index.ts";
import {
  CommitConflict,
  HistoricRevisionUnreadable,
  lock as lockVault,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "entry-restore-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const VAULT_ID = "88888888-8888-4888-8888-888888888888";

const originalGetRevision = api.getRevision.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.getRevision = originalGetRevision;
  api.commitSnapshot = originalCommit;
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function entry(partial: Partial<VaultEntry> & { id: string }): VaultEntry {
  return {
    ...emptyDraft("web"),
    id: partial.id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

// --- real-crypto fixtures (resolveSingleEntryRestore) ---

const vaultKey = generateVaultKey();
const salt = generateSalt(16);
const masterKey = deriveMasterKey(PASSWORD, salt, profile);

function master() {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId: VAULT_ID,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
}

function sealEntries(entries: readonly VaultEntry[]): EncryptedEntry[] {
  return entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey,
        vaultId: VAULT_ID,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion: 1,
        schemaVersion: 1,
      });
    } finally {
      zeroize(plaintext);
    }
  });
}

function historicSnapshot(revision: number, entries: readonly VaultEntry[]) {
  const envelopes = [master()];
  const encrypted = sealEntries(entries);
  return {
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1 as const,
    cryptoProtocolVersion: 1 as const,
    envelopes,
    entries: encrypted,
    sealedManifest: sealManifest({
      vaultKey,
      manifest: buildManifest({
        vaultId: VAULT_ID,
        revision,
        vaultKeyVersion: 1,
        envelopes,
        entries: encrypted,
      }),
    }),
  };
}

function unlockedVault(revision: number, entries: readonly VaultEntry[]): UnlockedVault {
  return {
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [master()],
    entries: [...entries],
    unlockedWith: "master_password",
  };
}

function selectionFor(snapshot: ReturnType<typeof historicSnapshot>) {
  return {
    vaultId: VAULT_ID,
    revision: snapshot.revision,
    vaultKeyVersion: 1,
    manifestDigest: bytesToBase64(sealedManifestDigest(snapshot.sealedManifest)),
  };
}

const CURRENT = entry({ id: "entry-live", title: "Live", username: "a", host: "live.example", password: "live-secret" });
const MISSING = entry({ id: "entry-missing", title: "Missing", username: "b", host: "missing.example", password: "missing-secret" });
const OTHER = entry({ id: "entry-other", title: "Other", username: "c", host: "other.example", password: "other-secret" });

// --- resolveSingleEntryRestore tests ---

test("resolveSingleEntryRestore restores exactly the selected entry and not the others", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING, OTHER]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  const next = await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);

  const ids = next.map((row) => row.id).sort();
  assert.deepEqual(ids, ["entry-live", "entry-missing"]);
  assert.equal(next.find((row) => row.id === "entry-missing")?.password, "missing-secret");
  assert.equal(next.some((row) => row.id === "entry-other"), false);
});

test("resolveSingleEntryRestore rejects an id that already exists", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  await assert.rejects(
    () => resolveSingleEntryRestore(vault, selectionFor(snapshot), CURRENT.id),
    EntryAlreadyPresentError,
  );
});

test("resolveSingleEntryRestore rejects an id absent from the selected revision", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  await assert.rejects(
    () => resolveSingleEntryRestore(vault, selectionFor(snapshot), "entry-ghost"),
    IntegrityError,
  );
});

test("resolveSingleEntryRestore refuses a revision sealed under an earlier vault key", async () => {
  const vault = { ...unlockedVault(5, [CURRENT]), vaultKeyVersion: 2 };
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  const selection = {
    vaultId: VAULT_ID,
    revision: 3,
    vaultKeyVersion: 1,
    manifestDigest: bytesToBase64(sealedManifestDigest(snapshot.sealedManifest)),
  };
  await assert.rejects(() => resolveSingleEntryRestore(vault, selection, MISSING.id), HistoricRevisionUnreadable);
});

test("resolveSingleEntryRestore rejects a source that no longer matches the selection", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  const selection = selectionFor(snapshot);
  const changed = historicSnapshot(3, [CURRENT, MISSING, OTHER]);
  api.getRevision = async () => encodeVaultSnapshot(changed);

  await assert.rejects(() => resolveSingleEntryRestore(vault, selection, MISSING.id), IntegrityError);
});

test("resolveSingleEntryRestore leaves the freshness pin alone", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  const pinned = { vaultId: VAULT_ID, revision: 5, vaultKeyVersion: 1, cryptoProtocolVersion: 1 as const };
  savePin(pinned);

  await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);

  assert.deepEqual(loadPin(VAULT_ID), pinned);
});

// --- restoreEntry orchestration tests (injected dependencies) ---

const SELECTION = { vaultId: VAULT_ID, revision: 3, vaultKeyVersion: 1, manifestDigest: "digest" };

function vaultFixture(entries: VaultEntry[] = []): UnlockedVault {
  return {
    vaultId: VAULT_ID,
    revision: 5,
    vaultKeyVersion: 1,
    vaultKey: new Uint8Array(32).fill(4),
    envelopes: [],
    entries,
    unlockedWith: "master_password",
  };
}

function restoredFixture(): VaultEntry {
  return entry({ id: "entry-restored", title: "Restored", password: "restored-secret", notes: "restored-note", totpSecret: "restored-totp" });
}

test("restoreEntry commits forward on the original vault", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  let committedEntries: VaultEntry[] | null = null;
  const committedVault = { ...vaultFixture([CURRENT, restored]), revision: 6 };
  const deps: RestoreEntryDependencies = {
    resolve: async () => [...current.entries, restored],
    commitEntries: async (_vault, entries) => {
      committedEntries = entries;
      return committedVault;
    },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  const result = await restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps);

  assert.equal(result, committedVault);
  assert.ok(committedEntries?.some((row) => row.id === "entry-restored"));
  // The handed-over object was disposed; the aliased current entry was not.
  assert.equal(restored.password, "");
  assert.equal(CURRENT.password, "live-secret");
});

test("restoreEntry: lock during the deferred fetch refuses the commit and wipes the resolved entry", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const fetch = deferred<VaultEntry[]>();
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: () => { events.push("resolve"); return fetch.promise; },
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (value) => { events.push("lock"); lockVault(value); },
  };
  let currentVault: UnlockedVault | null = current;
  let epoch = 0;
  const liveness = captureVaultLiveness(current, () => epoch, () => currentVault);
  const operation = restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps);

  await settle();
  assert.deepEqual(events, ["resolve"]);
  epoch += 1;
  currentVault = null;
  fetch.resolve([...current.entries, restored]);

  await assert.rejects(operation, VaultLockedError);
  assert.ok(!events.includes("commit"));
  assert.equal(restored.password, "");
  assert.equal(CURRENT.password, "live-secret");
});

test("restoreEntry: a vault switch during the fetch refuses the commit", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const fetch = deferred<VaultEntry[]>();
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: () => fetch.promise,
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (value) => lockVault(value),
  };
  let currentVault: UnlockedVault | null = current;
  const liveness = captureVaultLiveness(current, () => 0, () => currentVault);
  const operation = restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps);

  await settle();
  // A different vault object is now live (e.g. the user edited another entry).
  currentVault = { ...current, revision: 6 };
  fetch.resolve([...current.entries, restored]);

  await assert.rejects(operation, VaultLockedError);
  assert.ok(!events.includes("commit"));
  assert.equal(restored.password, "");
});

test("restoreEntry: cancel during the fetch returns null and never commits", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const fetch = deferred<VaultEntry[]>();
  let cancelled = false;
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: () => fetch.promise,
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);
  const operation = restoreEntry(
    { current, selection: SELECTION, entryId: restored.id, liveness, isCancelled: () => cancelled },
    deps,
  );

  await settle();
  cancelled = true;
  fetch.resolve([...current.entries, restored]);

  assert.equal(await operation, null);
  assert.ok(!events.includes("commit"));
  assert.equal(restored.password, "");
});

test("restoreEntry: a commit error still disposes the resolved entry", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const deps: RestoreEntryDependencies = {
    resolve: async () => [...current.entries, restored],
    commitEntries: async () => { throw new CommitConflict(6); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  await assert.rejects(
    () => restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps),
    CommitConflict,
  );
  assert.equal(restored.password, "");
  assert.equal(CURRENT.password, "live-secret");
});

test("restoreEntry: a commit that resolves after lock is zeroized, not adopted", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const commit = deferred<UnlockedVault>();
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: async () => [...current.entries, restored],
    commitEntries: () => { events.push("commit"); return commit.promise; },
    lock: (value) => { events.push("lock"); lockVault(value); },
  };
  let currentVault: UnlockedVault | null = current;
  let epoch = 0;
  const liveness = captureVaultLiveness(current, () => epoch, () => currentVault);
  const operation = restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps);

  await settle();
  assert.deepEqual(events, ["commit"]);
  const next = { ...vaultFixture(), revision: 6, vaultKey: new Uint8Array(32).fill(5) };
  epoch += 1;
  currentVault = null;
  commit.resolve(next);

  await assert.rejects(operation, VaultLockedError);
  assert.ok(events.includes("lock"));
  assert.ok(next.vaultKey.every((byte) => byte === 0));
});

test("a cancelled restore commits nothing and reports no saved feedback", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const fetch = deferred<VaultEntry[]>();
  let cancelled = false;
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: () => fetch.promise,
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);
  const dispatched: FeedbackAction[] = [];

  const operation = runWithStatus(
    (action) => dispatched.push(action),
    async () => {
      const committed = await restoreEntry(
        { current, selection: SELECTION, entryId: restored.id, liveness, isCancelled: () => cancelled },
        deps,
      );
      return committed !== null;
    },
    (committed) => (committed ? "entries_saved" : null),
  );

  await settle();
  cancelled = true;
  fetch.resolve([...current.entries, restored]);

  const result = await operation;
  assert.equal(result, false);
  assert.ok(!events.includes("commit"));
  assert.equal(dispatched.filter((action) => action.type === "notice").length, 0);
});

test("a committed restore reports exactly one saved feedback", async () => {
  const current = vaultFixture([CURRENT]);
  const restored = restoredFixture();
  const events: string[] = [];
  const deps: RestoreEntryDependencies = {
    resolve: async () => [...current.entries, restored],
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);
  const dispatched: FeedbackAction[] = [];

  const result = await runWithStatus(
    (action) => dispatched.push(action),
    async () => {
      const committed = await restoreEntry({ current, selection: SELECTION, entryId: restored.id, liveness }, deps);
      return committed !== null;
    },
    (committed) => (committed ? "entries_saved" : null),
  );

  assert.equal(result, true);
  assert.ok(events.includes("commit"));
  assert.equal(dispatched.filter((action) => action.type === "notice" && action.code === "entries_saved").length, 1);
});

test("restoreEntry: a single-entry restore commit keeps the CAS conflict contract", async () => {
  const current = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  api.commitSnapshot = async () => { throw new ApiError(409, { currentRevision: 6 }); };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  await assert.rejects(
    () => restoreEntry({ current, selection: selectionFor(snapshot), entryId: MISSING.id, liveness }),
    CommitConflict,
  );
});
