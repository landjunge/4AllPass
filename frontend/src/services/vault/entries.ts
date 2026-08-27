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
  return [...entries, { id: newEntryId(), ...draft, updatedAt }];
}

export function removeEntryById(entries: VaultEntry[], id: string): VaultEntry[] {
  return entries.filter((candidate) => candidate.id !== id);
}

export function appendDraft(entries: VaultEntry[], draft: EntryDraft): VaultEntry[] {
  return [...entries, { id: newEntryId(), ...draft, updatedAt: new Date().toISOString() }];
}

export function withDemoGithubEntry(entries: VaultEntry[]): VaultEntry[] {
  return appendDraft(entries, demoGithubDraft());
}

export function withAutofillDemoEntry(entries: VaultEntry[]): VaultEntry[] {
  if (entries.some(isAutofillDemoEntry)) return entries;
  return appendDraft(entries, autofillDemoDraft());
}
