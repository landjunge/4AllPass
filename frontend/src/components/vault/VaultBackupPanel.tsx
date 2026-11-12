import { useEffect, useRef, useState, type ReactNode } from "react";
import { BACKUP_FILE_LIMIT_BYTES, buildBackupPackage, downloadBackupFile } from "../../lib/backup.ts";
import type { Line } from "../../lib/copy-mode.ts";
import { CommitConflict, HistoricRevisionUnreadable } from "../../lib/vault-session.ts";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";

/**
 * V7.5 — Sicherung. One question: how do I keep an encrypted full copy?
 *
 * The backup is the current ciphertext snapshot (entries + encrypted envelopes
 * + sealed manifest). It never contains plaintext, the Vault Key or any secret.
 * Restoring on this device commits the recovered entries forward; on a new
 * device it needs the master password or recovery kit, so this is explicitly
 * not a portable share.
 */
export function VaultBackupPanel(): ReactNode {
  const { t } = useCopy();
  const { vault, restoreBackup } = useApp();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Line | null>(null);
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
      const pack = await buildBackupPackage(vault);
      downloadBackupFile(pack);
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

  async function restoreFile(file: File): Promise<void> {
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
    let text: string;
    try {
      text = await file.text();
    } catch {
      setNotice({ de: "Datei nicht lesbar.", en: "File not readable." });
      setBusy(false);
      return;
    }
    if (actionGen.current !== gen) return;
    try {
      // Success is reported once by the lifecycle's global backup_restored
      // notice; a cancelled restore reports nothing. Errors stay visible below.
      await restoreBackup(vault, text, () => actionGen.current !== gen);
    } catch (error) {
      if (error instanceof CommitConflict) {
        setNotice({
          de: "Der Tresor hat sich geändert. Bitte neu öffnen.",
          en: "The vault changed. Please reopen.",
        });
      } else if (error instanceof HistoricRevisionUnreadable) {
        setNotice({
          de: "Diese Sicherung ist vor einem Schlüsselwechsel und nicht lesbar.",
          en: "This backup is from before a key change and cannot be read.",
        });
      } else {
        setNotice({
          de: "Sicherung nicht lesbar oder beschädigt.",
          en: "Backup unreadable or damaged.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

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
          if (file) void restoreFile(file);
          event.target.value = "";
        }}
      />

      {notice ? (
        <p className="notice" data-testid="backup-notice">
          {t(notice)}
        </p>
      ) : null}
    </section>
  );
}
