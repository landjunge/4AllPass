import { useState, type FormEvent, type ReactNode } from "react";
import { looksLikeSharePackage } from "../lib/share.ts";
import { useApp } from "../state/app-state.tsx";

export function RestoreVaultPage({ onBack }: { onBack: () => void }): ReactNode {
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
        <h2>Tresor wiederherstellen / Restore vault</h2>
        <p className="muted">
          Öffne eine 4AllPass-Share-Datei plus Share-Schlüssel. Danach gilt ein neues
          Tresor-Passwort und ein neuer Recovery-Schlüssel. Der Share-Schlüssel ist nicht der
          Recovery-Schlüssel. Ohne die Datei reicht der Recovery-Schlüssel allein nicht.
        </p>
        <label>
          Share-Datei / Share file
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
          <p className="error-text">Das ist keine 4AllPass-Share-Datei (kind 4allpass-share-v1).</p>
        ) : null}
        <label>
          Share-Schlüssel / Share key
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
          Neues Tresor-Passwort / New vault password
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
          Wiederholen / Repeat
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
            data-testid="vault-password-repeat"
          />
        </label>
        {mismatch ? <p className="error-text">Die Passwörter stimmen nicht überein.</p> : null}
        <p className="hint">
          Die Datei bleibt auf diesem Gerät. Der Server sieht weder Datei noch Schlüssel.
        </p>
        <button
          type="submit"
          disabled={busy || mismatch || notShare || !fileText}
          data-testid="restore-vault"
        >
          {busy ? "Tresor wird erzeugt…" : "Wiederherstellen / Restore"}
        </button>
        <button type="button" className="link" onClick={onBack} data-testid="restore-back">
          Zurück / Back
        </button>
      </form>
    </div>
  );
}
