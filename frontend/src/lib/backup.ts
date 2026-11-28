/**
 * Encrypted full vault backup (P0 #279 "Backup" — a restore function, not a
 * portable-share or trash/purge promise).
 *
 * A backup is the current *wire* snapshot wrapped in a small envelope:
 * `{ kind, createdAt, snapshot }`. The snapshot contains only ciphertext
 * (entries), the required encrypted envelopes, the sealed manifest and opaque
 * metadata (vaultId / revision / key generations) — never `UnlockedVault`,
 * the Vault Key, a Device Key, raw recovery material, logins, provider keys or
 * plaintext entries.
 *
 * Export re-verifies the fetched snapshot under the current Vault Key and
 * against the freshness pin. Restore parses and structurally verifies the file
 * first, then opens it under the current Vault Key only (never an older key),
 * and commits the recovered entries forward via the existing liveness/CAS path.
 */
import {
  assertFreshSnapshot,
  decodeVaultSnapshot,
  IntegrityError,
  MANIFEST_ENTRIES_MAX,
  MANIFEST_ENVELOPES_MAX,
  revisionFromManifest,
  verifySnapshotManifest,
  type WireVaultSnapshot,
} from "@4allpass/crypto";
import { api } from "./api.ts";
import { entryIdExists, wipeVaultEntry, type VaultEntry } from "./entries.ts";
import { EntryAlreadyPresentError } from "./entry-restore.ts";
import { openHistoricSnapshot } from "./historic-snapshot.ts";
import { loadPin } from "./revision-pin.ts";
import { commitEntries, lock as lockVault, type UnlockedVault } from "./vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "./vault-liveness.ts";

export const BACKUP_KIND = "4allpass-backup-v1";

/** Ceiling for an accepted backup file, before any JSON parsing. */
export const BACKUP_FILE_LIMIT_BYTES = 64 * 1024 * 1024;

export interface BackupPackage {
  kind: typeof BACKUP_KIND;
  createdAt: string;
  snapshot: WireVaultSnapshot;
}

/** The file is not a valid 4AllPass backup (wrong kind / not JSON / no snapshot). */
export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

/** The file exceeds the accepted size ceiling. */
export class BackupLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupLimitExceededError";
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackupFormatError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Fetch the current snapshot and wrap it as a backup, after re-verifying it is
 * authentic (sealed under the current Vault Key) and not a rollback. Returns
 * ciphertext and metadata only.
 */
export async function buildBackupPackage(vault: UnlockedVault): Promise<BackupPackage> {
  const wire = await api.getSnapshot(vault.vaultId);
  const snapshot = decodeVaultSnapshot(wire);
  if (snapshot.vaultId !== vault.vaultId) {
    throw new IntegrityError("backup snapshot belongs to a different vault");
  }
  if (!snapshot.sealedManifest) {
    throw new IntegrityError("backup snapshot has no sealed manifest");
  }
  const verified = verifySnapshotManifest(
    snapshot.sealedManifest,
    { entries: snapshot.entries, envelopes: snapshot.envelopes },
    {
      vaultKey: vault.vaultKey,
      vaultId: snapshot.vaultId,
      revision: snapshot.revision,
      vaultKeyVersion: snapshot.vaultKeyVersion,
    },
  );
  // Do not back up a rolled-back state: the fetched snapshot must not be older
  // than the freshness pin. Reading it must not move the pin.
  assertFreshSnapshot(loadPin(vault.vaultId), revisionFromManifest(verified));
  return { kind: BACKUP_KIND, createdAt: new Date().toISOString(), snapshot: wire };
}

export function serializeBackupPackage(pack: BackupPackage): string {
  return JSON.stringify(pack);
}

/**
 * Parse and structurally verify a backup file without any key material: size
 * ceiling, kind, snapshot shape, versions, base64 lengths and envelope/entry
 * structure, plus the required sealed manifest.
 */
export function parseBackupPackage(
  text: string,
  options?: { maxBytes?: number },
): BackupPackage {
  const maxBytes = options?.maxBytes ?? BACKUP_FILE_LIMIT_BYTES;
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    throw new BackupLimitExceededError(`backup file is ${byteLength} bytes (limit ${maxBytes})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new BackupFormatError("backup file is not valid JSON");
  }
  const record = asRecord(parsed, "backup");
  if (record.kind !== BACKUP_KIND) {
    throw new BackupFormatError("not a 4AllPass backup file");
  }
  if (record.snapshot === undefined) {
    throw new BackupFormatError("backup file has no snapshot");
  }
  // Bound the declared record counts before base64-decoding each one, using
  // the same ceilings the manifest code already enforces (100k entries / 1k
  // envelopes). A hostile file must not drive an unbounded decode loop.
  const snapshotSource = asRecord(record.snapshot, "backup.snapshot");
  const entriesLength = Array.isArray(snapshotSource.entries) ? snapshotSource.entries.length : 0;
  const envelopesLength = Array.isArray(snapshotSource.envelopes) ? snapshotSource.envelopes.length : 0;
  if (entriesLength > MANIFEST_ENTRIES_MAX) {
    throw new BackupLimitExceededError(`backup declares ${entriesLength} entries (limit ${MANIFEST_ENTRIES_MAX})`);
  }
  if (envelopesLength > MANIFEST_ENVELOPES_MAX) {
    throw new BackupLimitExceededError(`backup declares ${envelopesLength} envelopes (limit ${MANIFEST_ENVELOPES_MAX})`);
  }
  // Structural validation: versions, base64 lengths, envelope/entry shapes.
  const snapshot = decodeVaultSnapshot(snapshotSource);
  if (!snapshot.sealedManifest) {
    throw new IntegrityError("backup snapshot is missing its sealed manifest");
  }
  return {
    kind: BACKUP_KIND,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    snapshot: record.snapshot as WireVaultSnapshot,
  };
}

/**
 * Open a parsed backup under the current Vault Key only: verifies the sealed
 * manifest and vault identity, refuses an earlier vault-key generation, and
 * decrypts the entries. Read-only — never moves the pin or cache.
 */
export function openBackupEntries(vault: UnlockedVault, pack: BackupPackage): VaultEntry[] {
  const snapshot = decodeVaultSnapshot(pack.snapshot);
  return openHistoricSnapshot(snapshot, vault).entries;
}

/** What a backup entry lists for selection — never a secret field. */
export interface BackupEntrySummary {
  readonly id: string;
  readonly title: string;
  readonly host: string;
}

/**
 * Decrypt a parsed backup only to list what it contains, for a selection UI:
 * title and host per entry, sorted, never a password/notes/TOTP value. Every
 * decrypted entry is wiped before this returns — nothing from the full
 * decrypt is kept beyond the id/title/host copied into the summary.
 */
export function listBackupEntries(vault: UnlockedVault, pack: BackupPackage): BackupEntrySummary[] {
  const opened = openBackupEntries(vault, pack);
  try {
    return opened
      .map((entry) => ({ id: entry.id, title: entry.title, host: entry.host }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } finally {
    for (const entry of opened) wipeVaultEntry(entry);
  }
}

/**
 * Open a parsed backup and hand out exactly one entry (by id), the same
 * shape as `resolveSingleEntryRestore` in entry-restore.ts, but local: no
 * server fetch, the backup's own integrity check (via `openBackupEntries`)
 * stands in for the revision re-fetch/re-bind. Rejects an id already present
 * in the current vault with the shared `EntryAlreadyPresentError`; every
 * decrypted entry that is not handed out is wiped on every path.
 */
export function resolveSingleEntryFromBackup(
  vault: UnlockedVault,
  pack: BackupPackage,
  entryId: string,
): VaultEntry[] {
  const opened = openBackupEntries(vault, pack);
  const chosen = opened.find((entry) => entry.id === entryId);
  try {
    if (!chosen) {
      throw new IntegrityError(`entry ${entryId} is not in this backup`);
    }
    if (entryIdExists(vault.entries, entryId)) {
      throw new EntryAlreadyPresentError(entryId);
    }
    for (const entry of opened) {
      if (entry.id !== entryId) wipeVaultEntry(entry);
    }
    return [...vault.entries, chosen].sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    // Rejection or error: nothing is handed out, so wipe every freshly
    // decrypted object (including the would-be selected entry).
    for (const entry of opened) wipeVaultEntry(entry);
    throw error;
  }
}

export function downloadBackupFile(pack: BackupPackage): void {
  const blob = new Blob([serializeBackupPackage(pack)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "4allpass-backup.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface RestoreBackupDependencies {
  parse(text: string): BackupPackage;
  open(vault: UnlockedVault, pack: BackupPackage): VaultEntry[];
  commitEntries(vault: UnlockedVault, entries: VaultEntry[], liveness: VaultLiveness): Promise<UnlockedVault>;
  lock(vault: UnlockedVault): void;
}

const restoreDefaults: RestoreBackupDependencies = {
  parse: (text) => parseBackupPackage(text),
  open: openBackupEntries,
  commitEntries: (vault, entries, liveness) => commitEntries(vault, entries, liveness),
  lock: lockVault,
};

export interface RestoreBackupInput {
  current: UnlockedVault;
  text: string;
  liveness: VaultLiveness;
  isCancelled?: () => boolean;
}

/**
 * Restore a full backup into the current vault as a forward commit. The backup
 * content replaces the current content (never an in-place overwrite or rewind);
 * the commit is bound to the original vault, so a lock, vault switch, hard
 * revoke or edit in between refuses the restore. Returns the committed vault,
 * or `null` when cancelled before the commit.
 */
export async function restoreBackup(
  input: RestoreBackupInput,
  dependencies: RestoreBackupDependencies = restoreDefaults,
): Promise<UnlockedVault | null> {
  input.liveness.assertLive();
  const pack = dependencies.parse(input.text);
  const entries = dependencies.open(input.current, pack);
  try {
    if (input.isCancelled?.() === true) return null;
    input.liveness.assertLive();
    const committed = await dependencies.commitEntries(input.current, entries, input.liveness);
    if (!input.liveness.isLive()) {
      dependencies.lock(committed);
      throw new VaultLockedError();
    }
    return committed;
  } finally {
    // Dispose the freshly decrypted backup entries on every outcome. They are
    // never the current vault's aliased entries.
    for (const entry of entries) wipeVaultEntry(entry);
  }
}

export interface RestoreBackupEntryDependencies {
  resolve(vault: UnlockedVault, pack: BackupPackage, entryId: string): VaultEntry[];
  commitEntries(vault: UnlockedVault, entries: VaultEntry[], liveness: VaultLiveness): Promise<UnlockedVault>;
  lock(vault: UnlockedVault): void;
}

const restoreBackupEntryDefaults: RestoreBackupEntryDependencies = {
  resolve: resolveSingleEntryFromBackup,
  commitEntries: (vault, entries, liveness) => commitEntries(vault, entries, liveness),
  lock: lockVault,
};

export interface RestoreBackupEntryInput {
  /** The exact vault the restore was initiated against. Never rebound. */
  current: UnlockedVault;
  pack: BackupPackage;
  entryId: string;
  /** Liveness captured *before* this call, against `current`. */
  liveness: VaultLiveness;
  /** True once the UI cancelled or unmounted the action; checked before commit. */
  isCancelled?: () => boolean;
}

/**
 * Restore exactly one entry out of an already-parsed backup, as a forward
 * commit on the original vault (never a rewind, never an overwrite of an id
 * that already exists). Mirrors `restoreEntry` in entry-restore.ts, but the
 * source is a local file, not a server revision fetch.
 */
export async function restoreBackupEntry(
  input: RestoreBackupEntryInput,
  dependencies: RestoreBackupEntryDependencies = restoreBackupEntryDefaults,
): Promise<UnlockedVault | null> {
  input.liveness.assertLive();
  const next = dependencies.resolve(input.current, input.pack, input.entryId);
  try {
    if (input.isCancelled?.() === true) return null;
    input.liveness.assertLive();
    const committed = await dependencies.commitEntries(input.current, next, input.liveness);
    if (!input.liveness.isLive()) {
      dependencies.lock(committed);
      throw new VaultLockedError();
    }
    return committed;
  } finally {
    // Dispose the handed-over entry on every outcome. It is the only foreign
    // object in `next` — the current vault's entries are aliased in there.
    const restored = next.find((entry) => entry.id === input.entryId);
    if (restored) wipeVaultEntry(restored);
  }
}
