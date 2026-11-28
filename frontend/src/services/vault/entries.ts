import { newEntryId, type EntryDraft, type VaultEntry } from "../../lib/entries.ts";
import { demoGithubDraft } from "../../lib/access-demo.ts";
import { autofillDemoDraft, isAutofillDemoEntry } from "../../lib/autofill-demo.ts";

export function upsertDraft(
  entries: VaultEntry[],
  draft: EntryDraft,
  selectedId: string | null,
): VaultEntry[] {
  const updatedAt = new Date().toISOString();
  if (selectedId) {
    return entries.map((entry) => (entry.id === selectedId ? { ...entry, ...draft, updatedAt } : entry));
  }
  return [...entries, { id: newEntryId(), ...draft, updatedAt, deletedAt: null }];
}

/** After save, keep this id selected so the desk does not jump back to empty. */
export function idAfterUpsert(
  before: VaultEntry[],
  after: VaultEntry[],
  selectedId: string | null,
): string | null {
  if (selectedId) return selectedId;
  const added = after.find((row) => !before.some((old) => old.id === row.id));
  return added?.id ?? after.at(-1)?.id ?? null;
}

export function removeEntryById(entries: VaultEntry[], id: string): VaultEntry[] {
  return entries.filter((candidate) => candidate.id !== id);
}

/** Only entries not marked deleted — what every normal view (list, search, health) shows. */
export function activeEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => entry.deletedAt == null);
}

/** Only entries marked deleted — the Papierkorb (trash) view. */
export function trashedEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => entry.deletedAt != null);
}

/**
 * Soft delete (P0 #279 "Papierkorb"): the entry stays in the committed
 * snapshot — still client-side encrypted, still covered by the sealed
 * manifest and still visible to version history — only `deletedAt` is set.
 * A no-op if the id is missing or already trashed.
 */
export function softDeleteEntryById(entries: VaultEntry[], id: string, now = new Date().toISOString()): VaultEntry[] {
  return entries.map((entry) =>
    entry.id === id && entry.deletedAt == null ? { ...entry, deletedAt: now, updatedAt: now } : entry,
  );
}

/** Restore a single trashed entry back to active. A no-op if it is not trashed. */
export function restoreEntryFromTrashById(
  entries: VaultEntry[],
  id: string,
  now = new Date().toISOString(),
): VaultEntry[] {
  return entries.map((entry) =>
    entry.id === id && entry.deletedAt != null ? { ...entry, deletedAt: null, updatedAt: now } : entry,
  );
}

/** Conscious, final purge — the only path that actually removes a trashed entry. */
export function purgeTrashedEntryById(entries: VaultEntry[], id: string): VaultEntry[] {
  return entries.filter((candidate) => !(candidate.id === id && candidate.deletedAt != null));
}

/**
 * Optional automatic retention (P0 #279): entries trashed longer than
 * `retentionDays` are purged. `retentionDays` of `null` or `<= 0` disables
 * this — the structure exists, nothing runs unless a retention is set.
 */
export function purgeExpiredTrash(
  entries: VaultEntry[],
  retentionDays: number | null,
  now = new Date(),
): VaultEntry[] {
  if (retentionDays == null || retentionDays <= 0) return entries;
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => {
    if (entry.deletedAt == null) return true;
    const deletedAtMs = new Date(entry.deletedAt).getTime();
    if (Number.isNaN(deletedAtMs)) return true;
    return now.getTime() - deletedAtMs < cutoffMs;
  });
}

export function appendDraft(entries: VaultEntry[], draft: EntryDraft): VaultEntry[] {
  return [...entries, { id: newEntryId(), ...draft, updatedAt: new Date().toISOString(), deletedAt: null }];
}

export function withDemoGithubEntry(entries: VaultEntry[]): VaultEntry[] {
  return appendDraft(entries, demoGithubDraft());
}

export function withAutofillDemoEntry(entries: VaultEntry[]): VaultEntry[] {
  if (entries.some(isAutofillDemoEntry)) return entries;
  return appendDraft(entries, autofillDemoDraft());
}
