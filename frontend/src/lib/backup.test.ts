/**
 * Encrypted full vault backup (P0 #279): export / integrity / restore.
 * Real crypto roundtrips plus the lifecycle orchestration with injected deps.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
  zeroize,
  type EncryptedEntry,
  type WireVaultSnapshot,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import {
  BACKUP_KIND,
  BackupFormatError,
  BackupLimitExceededError,
  buildBackupPackage,
  openBackupEntries,
  parseBackupPackage,
  restoreBackup,
  serializeBackupPackage,
  type BackupPackage,
  type RestoreBackupDependencies,
} from "./backup.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { savePin } from "./revision-pin.ts";
import { captureVaultLiveness, VaultLockedError } from "./vault-liveness.ts";
import {
  CommitConflict,
  HistoricRevisionUnreadable,
  lock as lockVault,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "backup-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const VAULT_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_VAULT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const originalGetSnapshot = api.getSnapshot.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.getSnapshot = originalGetSnapshot;
  api.commitSnapshot = originalCommit;
});

const vaultKey = generateVaultKey();
const salt = generateSalt(16);
const masterKey = deriveMasterKey(PASSWORD, salt, profile);

function entry(partial: Partial<VaultEntry> & { id: string }): VaultEntry {
  return {
    ...emptyDraft("web"),
    id: partial.id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

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

function snapshot(revision: number, entries: readonly VaultEntry[]) {
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

const A = entry({ id: "entry-a", title: "A", password: "BACKUP-SECRET-A", notes: "note-a", totpSecret: "totp-a" });
const B = entry({ id: "entry-b", title: "B", password: "BACKUP-SECRET-B" });

// --- export / integrity ---

test("a built backup is ciphertext-only and parses back structurally", async () => {
  const vault = unlockedVault(5, [A, B]);
  api.getSnapshot = async () => encodeVaultSnapshot(snapshot(5, [A, B]));
  savePin({ vaultId: VAULT_ID, revision: 5, vaultKeyVersion: 1, cryptoProtocolVersion: 1 });

  const pack = await buildBackupPackage(vault);
  assert.equal(pack.kind, BACKUP_KIND);
  const serialized = serializeBackupPackage(pack);
  assert.equal(serialized.includes("BACKUP-SECRET-A"), false);
  assert.equal(serialized.includes("BACKUP-SECRET-B"), false);
  assert.equal(serialized.includes("note-a"), false);
  assert.equal(serialized.includes("totp-a"), false);

  const parsed = parseBackupPackage(serialized);
  assert.equal(parsed.kind, BACKUP_KIND);
  const entries = openBackupEntries(vault, parsed);
  assert.deepEqual(entries.map((row) => row.id).sort(), ["entry-a", "entry-b"]);
  assert.equal(entries.find((row) => row.id === "entry-a")?.password, "BACKUP-SECRET-A");
});

test("a tampered backup fails to open", () => {
  const vault = unlockedVault(5, [A, B]);
  const snap = snapshot(5, [A, B]);
  const wire = encodeVaultSnapshot(snap) as WireVaultSnapshot;
  const tampered: BackupPackage = {
    kind: BACKUP_KIND,
    createdAt: "",
    snapshot: { ...wire, entries: wire.entries.slice(0, 1) },
  };
  assert.throws(() => openBackupEntries(vault, tampered), IntegrityError);
});

test("a backup from another vault fails to open", () => {
  const vault = unlockedVault(5, [A, B]);
  const snap = snapshot(5, [A, B]);
  const wrong = encodeVaultSnapshot({ ...snap, vaultId: OTHER_VAULT_ID });
  const pack: BackupPackage = { kind: BACKUP_KIND, createdAt: "", snapshot: wrong };
  assert.throws(() => openBackupEntries(vault, pack), IntegrityError);
});

test("a backup missing a required envelope fails to open", () => {
  const vault = unlockedVault(5, [A, B]);
  const snap = snapshot(5, [A, B]);
  const missing = encodeVaultSnapshot({ ...snap, envelopes: [] });
  const pack: BackupPackage = { kind: BACKUP_KIND, createdAt: "", snapshot: missing };
  assert.throws(() => openBackupEntries(vault, pack), IntegrityError);
});

test("a backup sealed under an earlier vault key refuses to open", () => {
  const vault = { ...unlockedVault(5, [A, B]), vaultKeyVersion: 2 };
  const snap = snapshot(5, [A, B]);
  const pack: BackupPackage = { kind: BACKUP_KIND, createdAt: "", snapshot: encodeVaultSnapshot(snap) };
  assert.throws(() => openBackupEntries(vault, pack), HistoricRevisionUnreadable);
});

test("parse enforces the file size ceiling before parsing", () => {
  assert.throws(
    () => parseBackupPackage("x".repeat(2048), { maxBytes: 128 }),
    BackupLimitExceededError,
  );
});

test("parse rejects a non-backup file", () => {
  assert.throws(() => parseBackupPackage("not json"), BackupFormatError);
  assert.throws(() => parseBackupPackage(JSON.stringify({ kind: "4allpass-share-v1" })), BackupFormatError);
  assert.throws(() => parseBackupPackage(JSON.stringify({ kind: BACKUP_KIND })), BackupFormatError);
});

test("parse bounds declared entry count before base64 decoding", () => {
  const entries = Array.from({ length: 100_001 }, () => "");
  const big = JSON.stringify({
    kind: BACKUP_KIND,
    createdAt: "",
    snapshot: {
      vaultId: VAULT_ID, revision: 1, vaultKeyVersion: 1, cryptoProtocolVersion: 1,
      envelopes: [], entries,
      sealedManifest: { version: 1, encryption: "AES-256-GCM", nonce: "!!", ciphertext: "!!", tag: "!!" },
    },
  });
  assert.throws(() => parseBackupPackage(big), BackupLimitExceededError);
});

test("parse bounds declared envelope count before base64 decoding", () => {
  const envelopes = Array.from({ length: 1_001 }, () => ({
    version: 1, type: "master", vaultKeyVersion: 1, encryption: "AES-256-GCM", nonce: "!!", ciphertext: "!!", tag: "!!",
  }));
  const big = JSON.stringify({
    kind: BACKUP_KIND,
    createdAt: "",
    snapshot: {
      vaultId: VAULT_ID, revision: 1, vaultKeyVersion: 1, cryptoProtocolVersion: 1,
      envelopes, entries: [],
      sealedManifest: { version: 1, encryption: "AES-256-GCM", nonce: "!!", ciphertext: "!!", tag: "!!" },
    },
  });
  assert.throws(() => parseBackupPackage(big), BackupLimitExceededError);
});

// --- restore orchestration ---

const PACK: BackupPackage = { kind: BACKUP_KIND, createdAt: "", snapshot: {} as WireVaultSnapshot };

function restoredFixture(): VaultEntry {
  return entry({ id: "entry-restored", title: "Restored", password: "restored-secret", notes: "n", totpSecret: "t" });
}

test("restoreBackup commits the backup forward on the original vault", async () => {
  const current = unlockedVault(5, []);
  const restored = restoredFixture();
  const committedVault = { ...unlockedVault(6, [restored]) };
  const deps: RestoreBackupDependencies = {
    parse: () => PACK,
    open: () => [restored],
    commitEntries: async () => committedVault,
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  const result = await restoreBackup({ current, text: "{}", liveness }, deps);

  assert.equal(result, committedVault);
  // Decrypted backup entries are disposed; they are not the current vault's.
  assert.equal(restored.password, "");
});

test("restoreBackup: lock during the commit refuses and wipes", async () => {
  const current = unlockedVault(5, []);
  const restored = restoredFixture();
  const commit = (() => {
    let resolve!: (v: UnlockedVault) => void;
    const promise = new Promise<UnlockedVault>((yes) => { resolve = yes; });
    return { promise, resolve };
  })();
  const events: string[] = [];
  const deps: RestoreBackupDependencies = {
    parse: () => PACK,
    open: () => [restored],
    commitEntries: () => { events.push("commit"); return commit.promise; },
    lock: (value) => { events.push("lock"); lockVault(value); },
  };
  let currentVault: UnlockedVault | null = current;
  let epoch = 0;
  const liveness = captureVaultLiveness(current, () => epoch, () => currentVault);
  const operation = restoreBackup({ current, text: "{}", liveness }, deps);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["commit"]);
  const next = { ...unlockedVault(6, [restored]), vaultKey: new Uint8Array(32).fill(5) };
  epoch += 1;
  currentVault = null;
  commit.resolve(next);

  await assert.rejects(operation, VaultLockedError);
  assert.ok(events.includes("lock"));
  assert.ok(next.vaultKey.every((byte) => byte === 0));
  assert.equal(restored.password, "");
});

test("restoreBackup: cancelled before dispatch returns null and never commits", async () => {
  const current = unlockedVault(5, []);
  const restored = restoredFixture();
  const events: string[] = [];
  const deps: RestoreBackupDependencies = {
    parse: () => PACK,
    open: () => [restored],
    commitEntries: async () => { events.push("commit"); return unlockedVault(6, []); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);
  // The action was already cancelled before it was dispatched.
  const result = await restoreBackup(
    { current, text: "{}", liveness, isCancelled: () => true },
    deps,
  );

  assert.equal(result, null);
  assert.ok(!events.includes("commit"));
  assert.equal(restored.password, "");
});

test("restoreBackup: a commit conflict surfaces and wipes", async () => {
  const current = unlockedVault(5, []);
  const restored = restoredFixture();
  const deps: RestoreBackupDependencies = {
    parse: () => PACK,
    open: () => [restored],
    commitEntries: async () => { throw new CommitConflict(6); },
    lock: (value) => lockVault(value),
  };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  await assert.rejects(
    () => restoreBackup({ current, text: "{}", liveness }, deps),
    CommitConflict,
  );
  assert.equal(restored.password, "");
});

test("restoreBackup keeps the CAS conflict contract with real crypto", async () => {
  const current = unlockedVault(5, [A, B]);
  const serialized = serializeBackupPackage({ kind: BACKUP_KIND, createdAt: "", snapshot: encodeVaultSnapshot(snapshot(5, [A, B])) });
  api.commitSnapshot = async () => { throw new ApiError(409, { currentRevision: 6 }); };
  const liveness = captureVaultLiveness(current, () => 0, () => current);

  await assert.rejects(
    () => restoreBackup({ current, text: serialized, liveness }),
    CommitConflict,
  );
});
