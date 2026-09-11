import { useState, type FormEvent, type ReactNode } from "react";
import { looksLikeSharePackage } from "../lib/share.ts";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

export function RestoreVaultPage({ onBack }: { onBack: () => void }): ReactNode {
  const { t } = useCopy();
  const { restoreFromShare } = useApp();
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [shareKey, setShareKey] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;
  const notShare = fileText.length > 0 && !looksLikeSharePackage(fileText);

  async function onFile(file: File): Promise<void> {
    setFileName(file.name);
    setFileText(await file.text());
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mismatch || notShare || !fileText) return;
    setBusy(true);
    try {
      await restoreFromShare(fileText, shareKey, password);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
      setPassword("");
      setRepeat("");
    }
  }

  return (
    <div className="centered">
      <form className="card auth" onSubmit={submit}>
        <h2>{t({ de: "Tresor wiederherstellen", en: "Restore vault" })}</h2>
        <p className="muted">
          {t({ de: "Öffne eine 4AllPass-Share-Datei plus Share-Schlüssel. Danach gilt ein neues Tresor-Passwort und ein neuer Recovery-Schlüssel. Der Share-Schlüssel ist nicht der Recovery-Schlüssel. Ohne die Datei reicht der Recovery-Schlüssel allein nicht.", en: "Open a 4AllPass share file plus share key. Then a new vault password and recovery key apply. The share key is not the recovery key. The recovery key alone is not enough without the file." })}
        </p>
        <label>
          {t({ de: "Share-Datei", en: "Share file" })}
        <input
            type="file"
            accept="application/json,.json"
            data-testid="restore-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>
        {fileName ? <p className="hint">{fileName}</p> : null}
        {notShare ? (
          <p className="error-text">
            {t({ de: "Das ist keine 4AllPass-Share-Datei (kind 4allpass-share-v1).", en: "This is not a 4AllPass share file." })}
          </p>
        ) : null}
        <label>
          {t({ de: "Share-Schlüssel", en: "Share key" })}
        <textarea
            value={shareKey}
            onChange={(event) => setShareKey(event.target.value)}
            rows={3}
            placeholder="XXXXX-XXXXX-XXXXX-…"
            required
            data-testid="restore-share-key"
          />
        </label>
        <label>
          {t({ de: "Neues Tresor-Passwort", en: "New vault password" })}
        <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            required
            data-testid="vault-password"
          />
        </label>
        <label>
          {t({ de: "Wiederholen", en: "Repeat" })}
        <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
            data-testid="vault-password-repeat"
          />
        </label>
        {mismatch ? (
          <p className="error-text">
            {t({ de: "Die Passwörter stimmen nicht überein.", en: "The passwords do not match." })}
          </p>
        ) : null}
        <p className="hint">
          {t({ de: "Die Datei bleibt auf diesem Gerät. Der Server sieht weder Datei noch Schlüssel.", en: "The file stays on this device. The server sees neither the file nor the keys." })}
        </p>
        <button
          type="submit"
          disabled={busy || mismatch || notShare || !fileText}
          data-testid="restore-vault"
        >
          {busy ? t({ de: "Tresor wird erzeugt…", en: "Creating vault…" }) : t({ de: "Wiederherstellen", en: "Restore" })}
        </button>
        <button type="button" className="link" onClick={onBack} data-testid="restore-back">
          {t({ de: "Zurück", en: "Back" })}
        </button>
      </form>
    </div>
  );
}
