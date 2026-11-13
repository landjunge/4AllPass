import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

/**
 * After a recovery unlock the old master password is unknown. The user sets a
 * new one deliberately; the Vault Key and the recovery envelope stay unchanged.
 * The component is mounted for the whole session but renders nothing unless a
 * recovery unlock is pending. Local inputs are dropped whenever the offer ends
 * (success, skip, lock, sign-out or vault switch) — best effort for JS strings,
 * not a memory-erasure guarantee.
 */
export function RecoveryMasterDialog(): ReactNode {
  const { recoveryMasterPending, vault, establishRecoveryMaster, skipRecoveryMaster, enableBiometrics } = useApp();
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterSet, setMasterSet] = useState(false);

  useEffect(() => {
    if (!recoveryMasterPending) {
      setPassword("");
      setConfirm("");
      setError(null);
      setBusy(false);
    }
    // A lock (no vault) or a new recovery unlock ends the offer. The short
    // transition where the vault is already master but state is still pending
    // must not clear it.
    if (!vault) setMasterSet(false);
    if (recoveryMasterPending) setMasterSet(false);
  }, [recoveryMasterPending, vault]);

  if (!recoveryMasterPending && !masterSet) return null;

  if (masterSet && !recoveryMasterPending) {
    async function enrol(): Promise<void> {
      setError(null);
      try {
        await enableBiometrics();
        setMasterSet(false);
      } catch {
        setError(t({
          de: "Geräte-Entsperren wurde nicht eingerichtet. Das neue Master-Passwort bleibt gesetzt; du kannst es später erneut versuchen.",
          en: "Device unlock was not set up. The new master password stays set; you can retry later.",
        }));
      }
    }
    return (
      <section className="card recovery-master" data-testid="recovery-device-offer" aria-labelledby="recovery-master-done">
        <h2 id="recovery-master-done">{t({ de: "Master-Passwort gesetzt", en: "Master password set" })}</h2>
        <p className="hint">
          {t({
            de: "Optional: dieses Gerät jetzt für Geräte-Entsperren einrichten. Dafür ist ein eigener Klick nötig.",
            en: "Optional: set up device unlock on this device now. This needs its own click.",
          })}
        </p>
        {error ? <p className="error-text" role="alert" data-testid="recovery-device-error">{error}</p> : null}
        <div className="row">
          <button type="button" onClick={() => void enrol()} data-testid="recovery-device-enrol">
            {t({ de: "Gerät jetzt einrichten", en: "Set up this device" })}
          </button>
          <button type="button" className="secondary" onClick={() => setMasterSet(false)} data-testid="recovery-device-later">
            {t({ de: "Später", en: "Later" })}
          </button>
        </div>
      </section>
    );
  }

  function clearInputs(): void {
    setPassword("");
    setConfirm("");
    setError(null);
  }

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
      clearInputs();
      setMasterSet(true);
    } catch {
      setError(t({
        de: "Das neue Master-Passwort konnte nicht gesetzt werden. Prüfe die Verbindung. Ein im Tresor widerrufenes Gerät darf keine Änderungen schreiben.",
        en: "The new master password could not be set. Check the connection. A device revoked in the vault may not write changes.",
      }));
    } finally {
      setBusy(false);
    }
  }

  function skip(): void {
    clearInputs();
    skipRecoveryMaster();
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
        {error ? <p className="error-text" role="alert" data-testid="recovery-master-error">{error}</p> : null}
        <div className="row">
          <button type="submit" disabled={busy} data-testid="recovery-master-submit">
            {busy
              ? t({ de: "Wird gesetzt…", en: "Setting…" })
              : t({ de: "Master-Passwort setzen", en: "Set master password" })}
          </button>
          <button type="button" className="secondary" onClick={skip} disabled={busy} data-testid="recovery-master-skip">
            {t({ de: "Später", en: "Later" })}
          </button>
        </div>
      </form>
      <p className="hint" data-testid="recovery-master-skip-hint">
        {t({
          de: "„Später“ ändert nichts: Der Tresor bleibt nur bis zum Sperren offen, und ohne Master-Passwort ist der nächste Öffnen-Versuch wieder auf das Recovery-Kit angewiesen. Geräte-Entsperren lässt sich danach getrennt einrichten.",
          en: "“Later” changes nothing: the vault stays open only until you lock it, and without a master password the next unlock needs the recovery kit again. Device unlock can be set up separately afterwards.",
        })}
      </p>
    </section>
  );
}
