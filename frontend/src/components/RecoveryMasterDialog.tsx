import { useState, type FormEvent, type ReactNode } from "react";
import { useCopy } from "../state/copy-mode.tsx";
import { FieldLabel } from "./vault/FieldLabel.tsx";
import type { RecoveryMasterOffer } from "../modules/recovery-management/index.ts";
import type { ErrorFeedback } from "../modules/feedback/index.ts";

export function RecoveryMasterDialog({ offer, error, passwordsCollide, complete, retryAdoption, dismiss, openDevices }: {
  offer: RecoveryMasterOffer;
  error: ErrorFeedback | null;
  passwordsCollide(password: string): boolean;
  complete(password: string, recoveryKeyText: string): Promise<void>;
  retryAdoption(): Promise<void>;
  dismiss(): void;
  openDevices(): void;
}): ReactNode {
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [kit, setKit] = useState("");
  const mismatch = repeat.length > 0 && password !== repeat;
  const sameAsAccount = passwordsCollide(password);
  async function retry(): Promise<void> {
    if (offer.busy) return;
    try {
      await retryAdoption();
    } catch {
      // Keep the local retry available; never display raw storage errors.
    }
  }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mismatch || sameAsAccount || offer.busy) return;
    try {
      await complete(password, kit);
    } catch {
      // Existing safe feedback is shown below; never render the thrown body.
    } finally {
      setPassword(""); setRepeat(""); setKit("");
    }
  }
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="recovery-master-title" data-testid="recovery-master-offer">
    <section className="card auth">
      <h2 id="recovery-master-title">{t(offer.pendingAdoption ? {
        de: "Passwortänderung lokal abschließen", en: "Finish the password change on this device",
      } : offer.stage === "password" ? {
        de: "Neues Tresor-Passwort wählen", en: "Choose a new vault password",
      } : { de: "Neues Tresor-Passwort gespeichert", en: "New vault password saved" })}</h2>
      <p>{t(offer.pendingAdoption ? {
        de: "Das neue Tresor-Passwort wurde bereits übernommen. Der Abschluss auf diesem Gerät ist noch offen. Versuche es erneut, ohne das Passwort nochmals zu ändern.",
        en: "The new vault password has already been applied. Finishing on this device is still pending. Try again without changing the password a second time.",
      } : {
        de: "Der Tresor wurde mit dem Recovery-Schlüssel geöffnet. Du kannst ein neues Passwort wählen und deine Geräte erneut anmelden. Das bisherige Passwort brauchst du dafür nicht.",
        en: "The vault was opened with the recovery key. You can choose a new password and re-enrol your devices. You do not need the previous password.",
      })}</p>
      <p className="hint">{t({
        de: "Ein neues Passwort entzieht bisherigen Geräten und Schlüsselinhabern keinen Zugriff. Alte Kopien bleiben lesbar. Bei Diebstahlverdacht ist zusätzlich ein Schlüsselwechsel nötig.",
        en: "A new password does not revoke access from existing devices or key holders. Old copies remain readable. Suspected theft also requires a key rotation.",
      })}</p>
      {offer.pendingAdoption ? <div>
        {error ? <p className="error-text" data-testid="recovery-master-error">{t(error.userText)}</p> : null}
        <button type="button" className="primary" disabled={offer.busy} onClick={() => void retry()} data-testid="retry-recovery-master-adoption">
          {t(offer.busy ? { de: "Wird abgeschlossen…", en: "Finishing…" } : { de: "Lokal erneut abschließen", en: "Retry on this device" })}
        </button>
      </div> : offer.stage === "password" ? <form onSubmit={submit}>
        <label><FieldLabel text={t({ de: "Neues Tresor-Passwort", en: "New vault password" })}
          tip={t({ de: "Nicht das Konto-Passwort. Bleibt auf diesem Gerät.", en: "Not the account password. Stays on this device." })} />
          <input type="password" autoComplete="new-password" minLength={10} required
            value={password} onChange={(event) => setPassword(event.target.value)} data-testid="recovery-new-password" />
        </label>
        <label><FieldLabel text={t({ de: "Wiederholen", en: "Repeat" })}
          tip={t({ de: "Muss genau mit dem neuen Passwort übereinstimmen.", en: "Must match the new password exactly." })} />
          <input type="password" autoComplete="new-password" required
            value={repeat} onChange={(event) => setRepeat(event.target.value)} data-testid="recovery-new-password-repeat" />
        </label>
        <label><FieldLabel text={t({ de: "Recovery-Schlüssel erneut bestätigen", en: "Confirm the recovery key again" })}
          tip={t({ de: "Das Kit bestätigt den Wechsel. Es wird nicht an den Dienst gesendet.", en: "The kit confirms this change. It is not sent to the service." })} />
          <textarea rows={3} autoComplete="off" required value={kit}
            onChange={(event) => setKit(event.target.value)} data-testid="recovery-master-kit" />
        </label>
        {mismatch ? <p className="error-text">{t({ de: "Die Passwörter stimmen nicht überein.", en: "The passwords do not match." })}</p> : null}
        {sameAsAccount ? <p className="error-text" data-testid="recovery-same-account-password">{t({
          de: "Nicht dasselbe wie das Konto-Passwort. Der Server sieht das Konto-Passwort.",
          en: "Not the same as the account password. The server sees the account password.",
        })}</p> : null}
        {error ? <p className="error-text" data-testid="recovery-master-error">{t(error.userText)}</p> : null}
        <button type="submit" className="primary" disabled={offer.busy || mismatch || sameAsAccount} data-testid="confirm-recovery-master">
          {t(offer.busy ? { de: "Wird gespeichert…", en: "Saving…" } : { de: "Neues Passwort speichern", en: "Save new password" })}
        </button>
      </form> : null}
      <div className="device-actions">
        {!offer.pendingAdoption ? <button type="button" className="secondary" disabled={offer.busy} onClick={openDevices} data-testid="recovery-open-devices">
          {t({ de: "Geräte neu anmelden", en: "Re-enrol devices" })}
        </button> : null}
        <button type="button" className="link" disabled={offer.busy} onClick={dismiss} data-testid="dismiss-recovery-master">
          {t(offer.pendingAdoption ? { de: "Tresor schließen", en: "Close vault" } : offer.stage === "password" ? { de: "Später", en: "Later" } : { de: "Fertig", en: "Done" })}
        </button>
      </div>
    </section>
  </div>;
}
