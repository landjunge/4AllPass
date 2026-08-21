import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

export function CreateVaultPage({ onBack }: { onBack?: () => void }): ReactNode {
  const { createNewVault } = useApp();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try {
      await createNewVault(password);
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
        <h2>Tresor anlegen / Create your vault</h2>
        <p className="muted">
          Wähle ein Tresor-Passwort. Wenn du es vergisst, öffnet nur der Recovery-Schlüssel auf dem
          nächsten Schirm diesen Tresor. Niemand kann ihn zurücksetzen — auch dieser Rechner nicht.
        </p>
        <label>
          Tresor-Passwort / Vault password
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
          Das Tresor-Passwort verlässt dieses Gerät nicht. Ein paar Sekunden Wartezeit sind Absicht.
        </p>
        <button type="submit" disabled={busy || mismatch} data-testid="create-vault">
          {busy ? "Tresor wird erzeugt…" : "Tresor anlegen / Create vault"}
        </button>
        {onBack ? (
          <button type="button" className="link" onClick={onBack} data-testid="create-back">
            Zurück / Back
          </button>
        ) : null}
      </form>
    </div>
  );
}
