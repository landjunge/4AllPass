import { useEffect, useState } from "react";
import { generatePassword } from "../../lib/entries.ts";
import type { BrowserLoginRow } from "../../lib/import.ts";
import { applyTemplate, BUILTIN_TEMPLATES, parseProviderTemplate } from "../../lib/providers.ts";
import { isOnboardingDone, markOnboardingDone } from "../../lib/onboarding.ts";
import { CLIPBOARD_CLEAR_MS, copySecret, readClipboardText } from "../../lib/clipboard.ts";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import {
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
  removeEntryById,
  selectedImportEntries,
  toggleImportPick,
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
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [customTemplate, setCustomTemplate] = useState("");

  useEffect(() => {
    setRevealPassword(false);
    setCopied(null);
  }, [selectedId]);

  const vaultId = vault?.vaultId;
  useEffect(() => {
    if (!vaultId) return;
    setOnboarding(!isOnboardingDone(vaultId));
  }, [vaultId]);

  const entries = vault?.entries ?? [];
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  function copyField(label: string, value: string): void {
    void copySecret(value)
      .then(() => setCopied(label))
      .catch(() => setCopied(null));
  }

  function startNew(kind: EntryKind = "web"): void {
    setSelectedId(null);
    setShowMore(false);
    setDraft(createNewDraft(kind));
  }

  function startEdit(entry: VaultEntry): void {
    setSelectedId(entry.id);
    setShowMore(draftHasAdvancedFields(entry));
    setDraft(draftFromEntry(entry));
  }

  function applyDetect(text: string): void {
    const result = applyDetectedText(text, draft?.password);
    setDetectedLabel(result.label);
    if ("draft" in result) setDraft(result.draft);
  }

  async function save(): Promise<void> {
    if (!draft || !vault) return;
    setBusy(true);
    try {
      const next = upsertDraft(entries, draft, selectedId);
      await saveEntries(next);
      const id = idAfterUpsert(entries, next, selectedId);
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
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function startShare(): void {
    if (!selected) return;
    try {
      setShare(createEntryShare(selected));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function openShare(): void {
    if (!shareImport) return;
    try {
      const opened = decryptSharePackage(shareImport.text, shareImport.key);
      setShareImport(null);
      setImportPending(pendingFromEntries(opened, "share"));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importPending || !vault) return;
    const fromBrowser = importPending.source === "browser";
    setBusy(true);
    try {
      const chosen = selectedImportEntries(importPending);
      if (chosen.length === 0) return;
      await saveEntries(mergeImport(entries, chosen, importPending.source));
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
        entries.map((candidate) =>
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

  async function remove(entry: VaultEntry): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(removeEntryById(entries, entry.id));
      setDraft(null);
      setSelectedId(null);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  function ingestBrowserLogins(rows: BrowserLoginRow[]): void {
    const pending = browserLoginsToPending(rows);
    if (!pending) {
      window.alert("Keine Passwörter gelesen. / No passwords read.");
      return;
    }
    setImportPending(pending);
  }

  async function ensureDemoLogin(): Promise<void> {
    const next = withAutofillDemoEntry(entries);
    if (next === entries) return;
    await saveEntries(next);
  }

  async function seedAccessDemo(): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(withDemoGithubEntry(entries));
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
        setDetectedLabel(
          "Zwischenablage nicht lesbar. Einfügen und Erkennen. / Clipboard blocked. Paste, then Detect.",
        );
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
      setDetectedLabel(
        `Template ${template.name}. ${t({
          de: "Speichern legt es verschlüsselt ab. Programme brauchen weiterhin Erlauben.",
          en: "Save encrypts it. Access still needs Allow.",
        })}`,
      );
    } catch (error) {
      setDetectedLabel(error instanceof Error ? error.message : String(error));
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

  return {
    vault,
    t,
    entries,
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
    toggleFavorite,
    save,
    onImportFile,
    startShare,
    openShare,
    confirmImport,
    remove,
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
    pickAllImport: () => importPending && setImportPending(pickAllImport(importPending)),
    pickNoneImport: () => importPending && setImportPending(pickNoneImport(importPending)),
    toggleImportPick: (id: string) =>
      importPending && setImportPending(toggleImportPick(importPending, id)),
  };
}
