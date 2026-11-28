import { LineError, type Line } from "../../lib/copy-mode.ts";
import { useEffect, useState } from "react";
import { generatePassword } from "../../lib/entries.ts";
import type { BrowserLoginRow } from "../../lib/import.ts";
import { applyTemplate, BUILTIN_TEMPLATES, parseProviderTemplate } from "../../lib/providers.ts";
import { isOnboardingDone, markOnboardingDone } from "../../lib/onboarding.ts";
import { getTrashRetentionDays, setTrashRetentionDays } from "../../lib/trash-retention.ts";
import { CLIPBOARD_CLEAR_MS, copySecret, readClipboardText } from "../../lib/clipboard.ts";
import { mergeDetectedCredential, mergeRotatedCredential } from "../../lib/detect.ts";
import { isUnchangedKey } from "../../lib/key-rotation.ts";
import { useKeyCreateCapture } from "./useKeyCreateCapture.ts";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import {
  activeEntries,
  applyDetectedText,
  browserLoginsToPending,
  createEntryShare,
  decryptSharePackage,
  mergeImport,
  parseVaultImportFile,
  pendingFromEntries,
  pickAllImport,
  pickNoneImport,
  idAfterUpsert,
  purgeExpiredTrash,
  purgeTrashedEntryById,
  restoreEntryFromTrashById,
  selectedImportEntries,
  softDeleteEntryById,
  toggleImportPick,
  trashedEntries,
  upsertDraft,
  withAutofillDemoEntry,
  withDemoGithubEntry,
} from "../../services/vault/index.ts";
import type {
  BuiltShare,
  EntryDraft,
  EntryKind,
  ImportPending,
  SettingsPane,
  ShareImport,
  VaultEntry,
  VaultTab,
} from "../../types/vault.ts";
import { createNewDraft, draftFromEntry, draftHasAdvancedFields } from "../../utils/vault/drafts.ts";
import {
  applyCleanup,
  type CleanupApplyRejected,
  type CleanupApplyResult,
  type CleanupRun,
} from "../../utils/vault/cleanup.ts";

const rotationUnchangedNotice: Line = {
  de: "Identisch mit dem bisherigen Schlüssel. Wurde beim Anbieter wirklich ein neuer erzeugt?",
  en: "Identical to the previous key. Was a new one actually created at the provider?",
};

export function useVaultState() {
  const { vault, saveEntries } = useApp();
  const { t } = useCopy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<VaultTab>("entries");
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("general");
  const [showMore, setShowMore] = useState(false);
  const [onboarding, setOnboarding] = useState(() => (vault ? !isOnboardingDone(vault.vaultId) : false));
  const [importPending, setImportPending] = useState<ImportPending | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [share, setShare] = useState<BuiltShare | null>(null);
  const [shareImport, setShareImport] = useState<ShareImport | null>(null);
  const [paste, setPaste] = useState("");
  const [detectedLabel, setDetectedLabel] = useState<Line | null>(null);
  const [customTemplate, setCustomTemplate] = useState("");
  // Identifies which open draft a running key-create clipboard capture
  // belongs to. Bumped whenever the open draft changes identity (a new
  // blank draft, a different existing entry selected, or the form closed) —
  // see useKeyCreateCapture's sessionKey param.
  const [draftSession, setDraftSession] = useState(0);
  // Rotation-only notice (issue #279 Punkt 5): set when a capture completed
  // but the "new" key is byte-for-byte the entry's current one — not an
  // error, just honesty that nothing actually changed at the provider.
  // Never blocks the merge below; the draft still updates (to the same
  // value), and Save still works as usual.
  const [rotationNotice, setRotationNotice] = useState<Line | null>(null);

  useEffect(() => {
    setRevealPassword(false);
    setCopied(null);
  }, [selectedId]);

  const vaultId = vault?.vaultId;
  useEffect(() => {
    if (!vaultId) return;
    setOnboarding(!isOnboardingDone(vaultId));
  }, [vaultId]);

  const [trashRetentionDays, setTrashRetentionDaysState] = useState<number | null>(null);
  useEffect(() => {
    setTrashRetentionDaysState(vaultId ? getTrashRetentionDays(vaultId) : null);
  }, [vaultId]);

  const allEntries = vault?.entries ?? [];
  const entries = activeEntries(allEntries);
  const trashEntries = trashedEntries(allEntries);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  // Optional automatic retention (P0 #279): sweep once per vault/setting
  // change. A no-op (no write) when nothing is actually expired yet.
  useEffect(() => {
    if (!vault || trashRetentionDays == null) return;
    const swept = purgeExpiredTrash(vault.entries, trashRetentionDays);
    if (swept.length !== vault.entries.length) {
      void saveEntries(swept).catch(() => {
        // Best-effort housekeeping; the banner (if any) is for user actions, not this.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.vaultId, vault?.revision, trashRetentionDays]);

  function copyField(label: string, value: string): void {
    void copySecret(value)
      .then(() => setCopied(label))
      .catch(() => setCopied(null));
  }

  function startNew(kind: EntryKind = "web"): void {
    setSelectedId(null);
    setShowMore(false);
    setDraft(createNewDraft(kind));
    setDraftSession((session) => session + 1);
    setRotationNotice(null);
  }

  function startEdit(entry: VaultEntry): void {
    setSelectedId(entry.id);
    setShowMore(draftHasAdvancedFields(entry));
    setDraft(draftFromEntry(entry));
    setDraftSession((session) => session + 1);
    setRotationNotice(null);
  }

  // Closing the form without saving must end any running capture for it too
  // — a hidden panel left capturing in the background is still a capture.
  function cancelEdit(): void {
    setDraft(null);
    setDraftSession((session) => session + 1);
    setRotationNotice(null);
  }

  function alertError(error: unknown): void {
    // LineError traegt beide Sprachen und wird uebersetzt gezeigt. Alles
    // andere ist technisch und bleibt, wie es kam.
    if (error instanceof LineError) {
      window.alert(t(error.line));
      return;
    }
    window.alert(error instanceof Error ? error.message : String(error));
  }

  function applyDetect(text: string): void {
    const result = applyDetectedText(text, draft?.password);
    setDetectedLabel(result.label);
    if ("draft" in result) setDraft(result.draft);
  }

  async function save(): Promise<void> {
    if (!draft || !vault) return;
    // Bumped *before* the snapshot below and the async write, not after —
    // a clipboard match resolving during the in-flight save must never
    // land on `draft` after it has already been snapshotted into `next`.
    setDraftSession((session) => session + 1);
    setRotationNotice(null);
    setBusy(true);
    try {
      const next = upsertDraft(allEntries, draft, selectedId);
      await saveEntries(next);
      const id = idAfterUpsert(allEntries, next, selectedId);
      const saved = next.find((row) => row.id === id);
      if (saved) {
        setSelectedId(saved.id);
        setDraft(draftFromEntry(saved));
      } else {
        setDraft(null);
        setSelectedId(null);
      }
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(file: File): Promise<void> {
    try {
      const parsed = await parseVaultImportFile(file);
      if (parsed.type === "share") {
        setShareImport({ text: parsed.text, key: "" });
        return;
      }
      setImportPending(pendingFromEntries(parsed.entries, "plaintext"));
    } catch (error) {
      alertError(error);
    }
  }

  function startShare(): void {
    if (!selected) return;
    try {
      setShare(createEntryShare(selected));
    } catch (error) {
      alertError(error);
    }
  }

  function openShare(): void {
    if (!shareImport) return;
    try {
      const opened = decryptSharePackage(shareImport.text, shareImport.key);
      setShareImport(null);
      setImportPending(pendingFromEntries(opened, "share"));
    } catch (error) {
      alertError(error);
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importPending || !vault) return;
    const fromBrowser = importPending.source === "browser";
    setBusy(true);
    try {
      const chosen = selectedImportEntries(importPending);
      if (chosen.length === 0) return;
      await saveEntries(mergeImport(allEntries, chosen, importPending.source));
      setImportPending(null);
      if (fromBrowser && onboarding) {
        markOnboardingDone(vault.vaultId);
        setOnboarding(false);
        setTab("entries");
      }
    } catch {
      // banner
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(entry: VaultEntry): Promise<void> {
    const nextFlag = !entry.favorite;
    try {
      await saveEntries(
        allEntries.map((candidate) =>
          candidate.id === entry.id
            ? { ...candidate, favorite: nextFlag, updatedAt: new Date().toISOString() }
            : candidate,
        ),
      );
      if (draft && selectedId === entry.id) setDraft({ ...draft, favorite: nextFlag });
    } catch {
      // The banner shows the reason.
    }
  }

  /**
   * Soft delete (P0 #279 "Papierkorb"): moves the entry to the trash view.
   * It stays in the committed, encrypted snapshot — nothing is purged here.
   */
  async function remove(entry: VaultEntry): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(softDeleteEntryById(allEntries, entry.id));
      setDraft(null);
      setSelectedId(null);
      setDraftSession((session) => session + 1);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  async function restoreTrashEntry(entry: VaultEntry): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(restoreEntryFromTrashById(allEntries, entry.id));
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  /** Conscious, final purge — the explicit second step the UI confirms before calling this. */
  async function purgeTrashEntry(entry: VaultEntry): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(purgeTrashedEntryById(allEntries, entry.id));
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  /**
   * Applies a (possibly partial) cleanup selection: merges duplicates to the
   * most complete/newest survivor and moves stale entries to trash, both via
   * soft delete — never a hard delete. Rejects without writing anything if
   * `run` no longer matches the current active entries (race since the
   * preview was computed); the panel then must recompute and let the user
   * decide again instead of applying a stale decision.
   */
  async function applyVaultCleanup(
    run: CleanupRun,
    selectedKeys: ReadonlySet<string>,
  ): Promise<CleanupApplyResult | CleanupApplyRejected> {
    const result = applyCleanup(allEntries, entries, run, selectedKeys);
    if (!result.ok) return result;
    setBusy(true);
    try {
      await saveEntries(result.entries);
      return result;
    } finally {
      setBusy(false);
    }
  }

  function updateTrashRetentionDays(days: number | null): void {
    if (!vaultId) return;
    setTrashRetentionDays(vaultId, days);
    setTrashRetentionDaysState(getTrashRetentionDays(vaultId));
  }

  function ingestBrowserLogins(rows: BrowserLoginRow[]): void {
    const pending = browserLoginsToPending(rows);
    if (!pending) {
      window.alert(t({ de: "Keine Passwörter gelesen.", en: "No passwords read." }));
      return;
    }
    setImportPending(pending);
  }

  async function ensureDemoLogin(): Promise<void> {
    const next = withAutofillDemoEntry(allEntries);
    if (next === allEntries) return;
    await saveEntries(next);
  }

  async function seedAccessDemo(): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(withDemoGithubEntry(allEntries));
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  function finishOnboarding(): void {
    if (!vault) return;
    markOnboardingDone(vault.vaultId);
    setOnboarding(false);
  }

  function detectFromClipboard(): void {
    void readClipboardText()
      .then((text) => {
        setPaste(text);
        applyDetect(text);
      })
      .catch(() => {
        setDetectedLabel({
          de: "Zwischenablage nicht lesbar. Einfügen und Erkennen.",
          en: "Clipboard blocked. Paste, then Detect.",
        });
      });
  }

  function applyBuiltinTemplate(templateId: string): void {
    if (!draft) return;
    const template = BUILTIN_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setDraft({
      ...applyTemplate(template, draft.account || "personal"),
      password: draft.password || generatePassword(),
    });
  }

  function applyCustomTemplate(): void {
    if (!draft) return;
    try {
      const template = parseProviderTemplate(customTemplate);
      setDraft({
        ...applyTemplate(template, draft.account || "personal"),
        password: draft.password || generatePassword(),
      });
      setDetectedLabel({
        de: `Template ${template.name}. Speichern legt es verschlüsselt ab. Programme brauchen weiterhin Erlauben.`,
        en: `Template ${template.name}. Save encrypts it. Access still needs Allow.`,
      });
    } catch (error) {
      // Eine Vorlagen-Fehlermeldung ist technisch und hat keine Uebersetzung.
      const reason = error instanceof Error ? error.message : String(error);
      setDetectedLabel({ de: reason, en: reason });
    }
  }

  function generateDraftPassword(): void {
    if (!draft) return;
    setDraft({ ...draft, password: generatePassword() });
  }

  function copyShareKey(): void {
    if (!share) return;
    void copySecret(share.shareKey)
      .then(() => setCopied(t({ de: "Share-Schlüssel", en: "Share key" })))
      .catch(() => undefined);
  }

  // "Neuen Schlüssel erstellen" (issue #278). Only ever applies to the open
  // draft, never writes to the vault itself — the existing Save button
  // still does that, and a duplicate is always surfaced by the panel
  // instead of silently folded in.
  const keyCreateCapture = useKeyCreateCapture(
    entries,
    !vault,
    (credential) => {
      setDraft((current) => (current && current.kind === "api" ? mergeDetectedCredential(current, credential) : current));
    },
    draftSession,
    draft?.kind === "api",
    draft?.account ?? "",
  );

  // "Schlüsselrotation" (issue #279 Punkt 5). Deliberately the exact same
  // hook as the #278 create flow above — same bounded clipboard capture,
  // same provider allow-list, same "never writes to the vault itself" rule
  // — pointed at the *open existing* entry instead of a new draft:
  // - `entries` excludes the entry being rotated, so a captured key cannot
  //   be reported as a "duplicate" of the very entry it is renewing.
  // - `isApiDraft` is true only while an existing API entry is selected,
  //   never for a brand-new draft (that stays the create panel's job, so
  //   there is never a question of which flow a captured key belongs to).
  const keyRotateCapture = useKeyCreateCapture(
    selectedId ? entries.filter((entry) => entry.id !== selectedId) : entries,
    !vault,
    (credential) => {
      if (selected) setRotationNotice(isUnchangedKey(selected, credential.password) ? rotationUnchangedNotice : null);
      setDraft((current) => (current && current.kind === "api" ? mergeRotatedCredential(current, credential) : current));
    },
    draftSession,
    draft?.kind === "api" && selectedId !== null,
    draft?.account ?? "",
  );

  return {
    vault,
    t,
    entries,
    trashEntries,
    trashRetentionDays,
    setTrashRetentionDays: updateTrashRetentionDays,
    selected,
    selectedId,
    draft,
    setDraft,
    busy,
    tab,
    setTab,
    settingsPane,
    setSettingsPane,
    showMore,
    setShowMore,
    onboarding,
    importPending,
    setImportPending,
    revealPassword,
    setRevealPassword,
    copied,
    share,
    setShare,
    shareImport,
    setShareImport,
    paste,
    setPaste,
    detectedLabel,
    customTemplate,
    setCustomTemplate,
    clipboardClearSeconds: CLIPBOARD_CLEAR_MS / 1000,
    copyField,
    startNew,
    startEdit,
    cancelEdit,
    toggleFavorite,
    save,
    onImportFile,
    startShare,
    openShare,
    confirmImport,
    remove,
    restoreTrashEntry,
    purgeTrashEntry,
    applyVaultCleanup,
    ingestBrowserLogins,
    ensureDemoLogin,
    seedAccessDemo,
    finishOnboarding,
    detectFromClipboard,
    applyDetect,
    applyBuiltinTemplate,
    applyCustomTemplate,
    generateDraftPassword,
    copyShareKey,
    keyCreateCapture,
    keyRotateCapture,
    rotationNotice,
    pickAllImport: () => importPending && setImportPending(pickAllImport(importPending)),
    pickNoneImport: () => importPending && setImportPending(pickNoneImport(importPending)),
    toggleImportPick: (id: string) =>
      importPending && setImportPending(toggleImportPick(importPending, id)),
  };
}
