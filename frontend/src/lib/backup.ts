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
  revisionFromManifest,
  verifySnapshotManifest,
  type WireVaultSnapshot,
} from "@4allpass/crypto";
import { api } from "./api.ts";
import { wipeVaultEntry, type VaultEntry } from "./entries.ts";
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
  // Structural validation: versions, base64 lengths, envelope/entry shapes.
  const snapshot = decodeVaultSnapshot(record.snapshot);
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
