import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

/**
 * After a recovery unlock the old master password is unknown. The user sets a
 * new one deliberately; the Vault Key and the recovery envelope stay unchanged.
 * The offer to enrol this device stays optional and uses the existing flow.
 */
export function RecoveryMasterDialog(): ReactNode {
  const { recoveryMasterPending, establishRecoveryMaster, skipRecoveryMaster, enableBiometrics } = useApp();
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [enroll, setEnroll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!recoveryMasterPending) return null;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (password !== confirm) {
      setError(t({ de: "Die beiden Passwörter stimmen nicht überein.", en: "The two passwords do not match." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await establishRecoveryMaster(password);
      setPassword("");
      setConfirm("");
      if (enroll) {
        try {
          await enableBiometrics();
        } catch {
          // The master password is already set; device unlock stays optional.
        }
      }
    } catch {
      setError(t({
        de: "Das neue Master-Passwort konnte nicht gesetzt werden. Prüfe die Verbindung. Ein im Tresor widerrufenes Gerät darf keine Änderungen schreiben.",
        en: "The new master password could not be set. Check the connection. A device revoked in the vault may not write changes.",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card recovery-master" data-testid="recovery-master-dialog" aria-labelledby="recovery-master-title">
      <h2 id="recovery-master-title">
        {t({ de: "Neues Master-Passwort setzen", en: "Set a new master password" })}
      </h2>
      <p className="hint">
        {t({
          de: "Du hast den Tresor mit dem Recovery-Kit geöffnet. Das alte Master-Passwort ist unbekannt. Setze jetzt ein neues; der Tresor-Schlüssel und das Recovery-Kit bleiben unverändert.",
          en: "You opened the vault with the recovery kit. The old master password is unknown. Set a new one now; the vault key and the recovery kit stay unchanged.",
        })}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {t({ de: "Neues Master-Passwort", en: "New master password" })}
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="recovery-master-password"
          />
        </label>
        <label>
          {t({ de: "Passwort wiederholen", en: "Repeat password" })}
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            data-testid="recovery-master-confirm"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enroll}
            onChange={(event) => setEnroll(event.target.checked)}
            data-testid="recovery-master-enroll"
          />
          {t({
            de: "Dieses Gerät danach für Geräte-Entsperren einrichten (optional)",
            en: "Set up device unlock on this device afterwards (optional)",
          })}
        </label>
        {error ? <p className="error-text" role="alert" data-testid="recovery-master-error">{error}</p> : null}
        <div className="row">
          <button type="submit" disabled={busy} data-testid="recovery-master-submit">
            {busy
              ? t({ de: "Wird gesetzt…", en: "Setting…" })
              : t({ de: "Master-Passwort setzen", en: "Set master password" })}
          </button>
          <button type="button" className="secondary" onClick={skipRecoveryMaster} disabled={busy} data-testid="recovery-master-skip">
            {t({ de: "Später", en: "Later" })}
          </button>
        </div>
      </form>
      <p className="hint" data-testid="recovery-master-skip-hint">
        {t({
          de: "„Später“ ändert nichts: Der Tresor bleibt nur bis zum Sperren offen, und ohne Master-Passwort ist der nächste Öffnen-Versuch wieder auf das Recovery-Kit angewiesen.",
          en: "“Later” changes nothing: the vault stays open only until you lock it, and without a master password the next unlock needs the recovery kit again.",
        })}
      </p>
    </section>
  );
}
