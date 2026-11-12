/**
 * Single-entry restore from a superseded revision (P0 #279, "Papierkorb"
 * preparation — this is a restore function, not a trash/purge/sync promise).
 *
 * Read-only until the caller commits: this re-fetches and re-binds the source
 * revision, opens it under the *current* Vault Key only (never an older key),
 * and returns the restored entry list. The caller commits it through the
 * existing `saveEntries` path (liveness + forward CAS + sealed manifest).
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
import type { UnlockedVault } from "./vault-session.ts";

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
 * Resolve exactly one entry from a selected historical revision into the
 * current vault's entry list. Does not commit — the caller does that via the
 * normal forward-commit path so liveness and CAS stay in one place.
 *
 * Throws when the source no longer matches the selection (`IntegrityError`),
 * when the entry is absent from that revision (`IntegrityError`), when the id
 * already exists (`EntryAlreadyPresentError`), or when the revision was sealed
 * under an earlier vault key (`HistoricRevisionUnreadable`).
 */
export async function resolveSingleEntryRestore(
  vault: UnlockedVault,
  selection: HistoricSelection,
  entryId: string,
): Promise<VaultEntry[]> {
  // Re-fetch and re-bind: vault identity, revision and manifest digest must
  // still match the selection the user was shown.
  const snapshot = decodeVaultSnapshot(await api.getRevision(vault.vaultId, selection.revision));
  assertHistoricSelection(snapshot, selection, vault.vaultId);
  const opened = openHistoricSnapshot(snapshot, vault);
  const historic = opened.entries.find((entry) => entry.id === entryId);
  if (!historic) {
    throw new IntegrityError(`entry ${entryId} is not in revision ${selection.revision}`);
  }
  if (entryIdExists(vault.entries, entryId)) {
    throw new EntryAlreadyPresentError(entryId);
  }
  // Wipe the historical plaintext objects we are not restoring.
  for (const entry of opened.entries) {
    if (entry.id !== entryId) wipeVaultEntry(entry);
  }
  return [...vault.entries, historic].sort((a, b) => a.title.localeCompare(b.title));
}
