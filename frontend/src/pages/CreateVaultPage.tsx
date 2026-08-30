import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

export function CreateVaultPage({
  onRestore,
}: {
  onRestore?: () => void;
}): ReactNode {
  const { createNewVault, passwordsCollide } = useApp();
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;
  const sameAsAccount = passwordsCollide(password);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mismatch || sameAsAccount) return;
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
        <h2>{t({ de: "Tresor anlegen", en: "Create your vault" })}</h2>
        <p className="muted">
          {t({
            de: "Wenn du das vergisst, hilft nur der Recovery-Schlüssel. Niemand setzt es zurück.",
            en: "If you forget this, only the recovery key helps. Nobody can reset it.",
          })}
        </p>
        <label>
          {t({ de: "Tresor-Passwort", en: "Vault password" })}
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
        {sameAsAccount ? (
          <p className="error-text" data-testid="same-password-error">
            {t({
              de: "Nicht dasselbe wie das Konto-Passwort. Der Server sieht das Konto-Passwort.",
              en: "Not the same as the account password. The server sees the account password.",
            })}
          </p>
        ) : null}
        <p className="hint">
          {t({
            de: "Verlässt dieses Gerät nicht. Ein paar Sekunden Wartezeit sind Absicht.",
            en: "Does not leave this device. A few seconds of waiting is intentional.",
          })}
        </p>
        <button type="submit" className="primary" disabled={busy || mismatch || sameAsAccount} data-testid="create-vault">
          {busy
            ? t({ de: "Tresor wird erzeugt…", en: "Creating vault…" })
            : t({ de: "Tresor anlegen", en: "Create vault" })}
        </button>
        {onRestore ? (
          <button type="button" className="link" onClick={onRestore} data-testid="create-back">
            {t({ de: "Ich habe einen Tresor", en: "I have a vault" })}
          </button>
        ) : null}
      </form>
    </div>
  );
}
