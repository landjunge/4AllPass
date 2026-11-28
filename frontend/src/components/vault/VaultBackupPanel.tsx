import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BACKUP_FILE_LIMIT_BYTES,
  buildBackupPackage,
  downloadBackupFile,
  listBackupEntries,
  parseBackupPackage,
  type BackupEntrySummary,
  type BackupPackage,
} from "../../lib/backup.ts";
import type { Line } from "../../lib/copy-mode.ts";
import { EntryAlreadyPresentError } from "../../lib/entry-restore.ts";
import { entryIdExists } from "../../lib/entries.ts";
import { CommitConflict, HistoricRevisionUnreadable } from "../../lib/vault-session.ts";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";

function describeRestoreError(error: unknown): Line {
  if (error instanceof CommitConflict) {
    return { de: "Der Tresor hat sich geändert. Bitte neu öffnen.", en: "The vault changed. Please reopen." };
  }
  if (error instanceof HistoricRevisionUnreadable) {
    return {
      de: "Diese Sicherung ist vor einem Schlüsselwechsel und nicht lesbar.",
      en: "This backup is from before a key change and cannot be read.",
    };
  }
  if (error instanceof EntryAlreadyPresentError) {
    return { de: "Dieser Eintrag ist bereits im Tresor.", en: "This entry is already in the vault." };
  }
  return { de: "Sicherung nicht lesbar oder beschädigt.", en: "Backup unreadable or damaged." };
}

/**
 * V7.5 — Sicherung. One question: how do I keep an encrypted full copy?
 *
 * The backup is the current ciphertext snapshot (entries + encrypted envelopes
 * + sealed manifest). It never contains plaintext, the Vault Key or any secret.
 * Reading a backup file only decrypts it locally to list titles/hosts for
 * picking — the list in this panel never shows a password. Restoring, whether
 * the whole backup or a single picked entry, always commits a *new* state
 * forward (never an overwrite or rewind); a single entry is refused when its
 * id already exists in the current vault. On a new device it needs the
 * master password or recovery kit, so this is explicitly not a portable share.
 */
export function VaultBackupPanel(): ReactNode {
  const { t } = useCopy();
  const { vault, restoreBackup, restoreBackupEntry } = useApp();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Line | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pack, setPack] = useState<BackupPackage | null>(null);
  const [entries, setEntries] = useState<BackupEntrySummary[] | null>(null);
  const [overlayNotice, setOverlayNotice] = useState<Line | null>(null);
  const actionGen = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    actionGen.current += 1;
  }, []);

  if (!vault) return null;

  async function createBackup(): Promise<void> {
    if (!vault) return;
    setBusy(true);
    setNotice(null);
    try {
      const built = await buildBackupPackage(vault);
      downloadBackupFile(built);
      setNotice({
        de: "Sicherungsdatei wird heruntergeladen. Sie enthält nur verschlüsselte Daten.",
        en: "Backup file is downloading. It contains only encrypted data.",
      });
    } catch {
      setNotice({
        de: "Sicherung konnte nicht erstellt werden.",
        en: "The backup could not be created.",
      });
    } finally {
      setBusy(false);
    }
  }

  function closeOverlay(): void {
    actionGen.current += 1;
    setText(null);
    setPack(null);
    setEntries(null);
    setOverlayNotice(null);
  }

  async function openFile(file: File): Promise<void> {
    if (!vault) return;
    const gen = actionGen.current;
    setBusy(true);
    setNotice(null);
    // Reject an oversized file before reading it into memory.
    if (file.size > BACKUP_FILE_LIMIT_BYTES) {
      setNotice({
        de: "Datei ist zu groß.",
        en: "File is too large.",
      });
      setBusy(false);
      return;
    }
    let fileText: string;
    try {
      fileText = await file.text();
    } catch {
      setNotice({ de: "Datei nicht lesbar.", en: "File not readable." });
      setBusy(false);
      return;
    }
    if (actionGen.current !== gen) return;
    try {
      // Parse and structurally verify first (integrity check), then decrypt
      // only to list titles/hosts for picking — never a password here.
      const parsed = parseBackupPackage(fileText);
      const summary = listBackupEntries(vault, parsed);
      setText(fileText);
      setPack(parsed);
      setEntries(summary);
    } catch (error) {
      setNotice(describeRestoreError(error));
    } finally {
      setBusy(false);
    }
  }

  async function restoreWhole(): Promise<void> {
    if (!vault || text === null) return;
    const gen = actionGen.current;
    setBusy(true);
    setOverlayNotice(null);
    try {
      // Success is reported once by the lifecycle's global backup_restored
      // notice; a cancelled restore reports nothing. Errors stay visible below.
      const committed = await restoreBackup(vault, text, () => actionGen.current !== gen);
      if (!committed) return; // cancelled or unmounted while fetching
      closeOverlay();
    } catch (error) {
      setOverlayNotice(describeRestoreError(error));
    } finally {
      setBusy(false);
    }
  }

  async function restoreOneEntry(summary: BackupEntrySummary): Promise<void> {
    if (!vault || pack === null) return;
    // Friendly, decrypt-free rejection when the id is already present.
    if (entryIdExists(vault.entries, summary.id)) {
      setOverlayNotice({
        de: "Dieser Eintrag ist bereits im Tresor.",
        en: "This entry is already in the vault.",
      });
      return;
    }
    const gen = actionGen.current;
    setBusy(true);
    setOverlayNotice(null);
    try {
      const committed = await restoreBackupEntry(vault, pack, summary.id, () => actionGen.current !== gen);
      if (!committed) return; // cancelled or unmounted
      closeOverlay();
    } catch (error) {
      setOverlayNotice(describeRestoreError(error));
    } finally {
      setBusy(false);
    }
  }

  const untitled = t({ de: "Ohne Titel", en: "Untitled" });

  return (
    <section className="card" data-testid="settings-backup">
      <h3>{t({ de: "Sicherung", en: "Backup" })}</h3>
      <p className="hint">
        {t({
          de: "Eine verschlüsselte Gesamtsicherung als Datei. Sie enthält nur Chiffretext — nie Passwörter oder Schlüssel. Zum Wiederherstellen auf einem anderen Gerät brauchst du das Master-Passwort oder das Recovery-Kit. Sie ist keine teilbare Freigabe.",
          en: "An encrypted full backup as a file. It contains only ciphertext — never passwords or keys. Restoring on another device needs the master password or recovery kit. It is not a share.",
        })}
      </p>

      <button
        type="button"
        className="primary"
        data-testid="backup-create"
        disabled={busy}
        onClick={() => void createBackup()}
      >
        {t({ de: "Sicherung erstellen", en: "Create backup" })}
      </button>

      <button
        type="button"
        className="link"
        data-testid="backup-restore"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
      >
        {t({ de: "Sicherung wiederherstellen", en: "Restore backup" })}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        data-testid="backup-restore-input"
        disabled={busy}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />

      {notice ? (
        <p className="notice" data-testid="backup-notice">
          {t(notice)}
        </p>
      ) : null}

      {entries !== null ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card">
            <h3>{t({ de: "Diese Sicherung", en: "This backup" })}</h3>
            <p className="hint">
              {t({
                de: "Titel und Host der enthaltenen Einträge. Passwörter zeigt diese Liste nie.",
                en: "Title and host of the entries it contains. This list never shows passwords.",
              })}
            </p>
            {entries.length === 0 ? (
              <p className="muted" data-testid="backup-preview-empty">
                {t({ de: "Diese Sicherung enthält keine Einträge.", en: "This backup contains no entries." })}
              </p>
            ) : (
              <ul className="history-preview" data-testid="backup-preview">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="history-entry-line">
                      <strong>{entry.title || untitled}</strong>
                      {entry.host ? <span className="muted"> · {entry.host}</span> : null}
                    </span>
                    <button
                      type="button"
                      className="link"
                      data-testid={`backup-restore-entry-${entry.id}`}
                      disabled={busy}
                      onClick={() => void restoreOneEntry(entry)}
                    >
                      {t({ de: "Nur diesen Eintrag", en: "This entry only" })}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {overlayNotice ? (
              <p className="notice" data-testid="backup-restore-notice">
                {t(overlayNotice)}
              </p>
            ) : null}

            <p className="hint">
              {t({
                de: "Die ganze Sicherung wiederherstellen ersetzt den jetzigen Inhalt durch diesen. Der jetzige Stand bleibt als früherer Stand weiter aufgehoben.",
                en: "Restoring the whole backup replaces the current content with this one. The current state stays kept as an earlier state.",
              })}
            </p>
            <button
              type="button"
              className="primary"
              data-testid="backup-restore-whole"
              disabled={busy}
              onClick={() => void restoreWhole()}
            >
              {t({ de: "Ganze Sicherung wiederherstellen", en: "Restore whole backup" })}
            </button>
            <button type="button" className="link" data-testid="backup-restore-cancel" onClick={closeOverlay}>
              {t({ de: "Abbrechen", en: "Cancel" })}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
