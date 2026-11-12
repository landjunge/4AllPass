/**
 * Single-entry restore from a superseded revision (P0 #279, "Papierkorb"
 * preparation — a restore function, not a trash/purge/sync promise).
 *
 * Split in two halves with clear plaintext ownership:
 *
 * - `resolveSingleEntryRestore` re-fetches, re-binds and decrypts the selected
 *   revision, then hands exactly one entry to the caller. It owns every
 *   freshly decrypted object it does not hand out and wipes them on every path.
 * - `restoreEntry` orchestrates the lifecycle: it binds the original vault and
 *   its liveness *before* the first await, checks it again after the fetch and
 *   immediately before commit, commits on the original context (never a newer
 *   one), and disposes the handed-over entry after the commit wins or loses.
 *
 * No pin/cache write happens here — reading history must stay a read.
 */
import { decodeVaultSnapshot, IntegrityError } from "@4allpass/crypto";
import { api } from "./api.ts";
import { entryIdExists, wipeVaultEntry, type VaultEntry } from "./entries.ts";
import {
  assertHistoricSelection,
  openHistoricSnapshot,
  type HistoricSelection,
} from "./historic-snapshot.ts";
import { commitEntries, lock as lockVault, type UnlockedVault } from "./vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "./vault-liveness.ts";

/** The chosen entry id already exists in the current vault — no merge/overwrite/rename. */
export class EntryAlreadyPresentError extends Error {
  readonly entryId: string;

  constructor(entryId: string) {
    super(`entry ${entryId} already exists in the current vault`);
    this.name = "EntryAlreadyPresentError";
    this.entryId = entryId;
  }
}

/**
 * Re-fetch and re-bind the source revision, decrypt it under the *current*
 * Vault Key only (never an older key), and return the restored entry list.
 * The caller receives the selected entry and becomes responsible for wiping it;
 * every other freshly decrypted object is wiped before this returns or throws.
 */
export async function resolveSingleEntryRestore(
  vault: UnlockedVault,
  selection: HistoricSelection,
  entryId: string,
): Promise<VaultEntry[]> {
  const snapshot = decodeVaultSnapshot(await api.getRevision(vault.vaultId, selection.revision));
  assertHistoricSelection(snapshot, selection, vault.vaultId);
  const opened = openHistoricSnapshot(snapshot, vault);
  const historic = opened.entries.find((entry) => entry.id === entryId);
  try {
    if (!historic) {
      throw new IntegrityError(`entry ${entryId} is not in revision ${selection.revision}`);
    }
    if (entryIdExists(vault.entries, entryId)) {
      throw new EntryAlreadyPresentError(entryId);
    }
    // Wipe the freshly decrypted entries we are not handing out. The selected
    // one stays; the caller owns its disposal.
    for (const entry of opened.entries) {
      if (entry.id !== entryId) wipeVaultEntry(entry);
    }
    return [...vault.entries, historic].sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    // Rejection or error: nothing is handed out, so wipe every freshly
    // decrypted object (including the would-be selected entry).
    for (const entry of opened.entries) {
      wipeVaultEntry(entry);
    }
    throw error;
  }
}

export interface RestoreEntryDependencies {
  resolve(vault: UnlockedVault, selection: HistoricSelection, entryId: string): Promise<VaultEntry[]>;
  commitEntries(vault: UnlockedVault, entries: VaultEntry[], liveness: VaultLiveness): Promise<UnlockedVault>;
  lock(vault: UnlockedVault): void;
}

const restoreDefaults: RestoreEntryDependencies = {
  resolve: resolveSingleEntryRestore,
  commitEntries: (vault, entries, liveness) => commitEntries(vault, entries, liveness),
  lock: lockVault,
};

export interface RestoreEntryInput {
  /** The exact vault the restore was initiated against. Never rebound. */
  current: UnlockedVault;
  selection: HistoricSelection;
  entryId: string;
  /** Liveness captured *before* the first await, against `current`. */
  liveness: VaultLiveness;
  /** True once the UI cancelled or unmounted the action; checked before commit. */
  isCancelled?: () => boolean;
}

/**
 * Orchestrate a single-entry restore against one original vault. Returns the
 * committed vault, or `null` when the action was cancelled before the commit.
 *
 * A lock, vault switch, hard revoke or any edit that replaces the vault makes
 * `liveness` stale; the commit is then refused instead of landing on a newer
 * context (which would silently drop the newer edits).
 */
export async function restoreEntry(
  input: RestoreEntryInput,
  dependencies: RestoreEntryDependencies = restoreDefaults,
): Promise<UnlockedVault | null> {
  input.liveness.assertLive();
  const next = await dependencies.resolve(input.current, input.selection, input.entryId);
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
    // Dispose the handed-over entry on every outcome (success, commit error,
    // cancel, lock). It is the only foreign object in `next` — the current
    // vault's entries are aliased in there and must never be wiped.
    const restored = next.find((entry) => entry.id === input.entryId);
    if (restored) wipeVaultEntry(restored);
  }
}
