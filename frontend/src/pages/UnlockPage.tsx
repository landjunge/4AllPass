import { useState, type FormEvent, type ReactNode } from "react";
import { FieldLabel } from "../components/vault/FieldLabel.tsx";
import type { HeadRecovery } from "../lib/vault-session.ts";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

const MECHANISM_LABEL: Record<string, string> = {
  prf: "WebAuthn PRF (rank 1)",
  large_blob: "WebAuthn largeBlob (rank 2)",
  uv_gated_local: "UV-gated local store (rank 3 — policy only)",
};

export function UnlockPage(): ReactNode {
  const {
    unlockWithPassword,
    unlockWithRecovery,
    unlockWithBiometrics,
    deviceUnlockAvailable,
    findHeadRecovery,
    restoreHeadRecovery,
  } = useApp();
  const { t } = useCopy();
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState<"none" | "password" | "device" | "recovery">("none");
  const [damaged, setDamaged] = useState(false);
  const [heldPassword, setHeldPassword] = useState("");
  const [searched, setSearched] = useState(false);
  const [recoverable, setRecoverable] = useState<HeadRecovery | null>(null);
  const [mechanism, setMechanism] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy("password");
    setSearched(false);
    setRecoverable(null);
    const attempted = password;
    try {
      if (useRecovery) await unlockWithRecovery(recovery);
      else await unlockWithPassword(password);
      setDamaged(false);
    } catch {
      // A damaged head and a wrong password are genuinely indistinguishable
      // here: a manifest sealed for another revision fails AEAD exactly like
      // the wrong key does. So do not guess which one it was — say both are
      // possible and let the search settle it (ADR-015 §2). Trying an older
      // revision with this same password is the only honest test.
      if (!useRecovery) {
        setDamaged(true);
        setHeldPassword(attempted);
      }
    } finally {
      setBusy("none");
      setPassword("");
      setRecovery("");
    }
  }

  async function lookForRecovery(): Promise<void> {
    setBusy("recovery");
    setSearched(true);
    try {
      setRecoverable(await findHeadRecovery(heldPassword));
    } catch {
      setRecoverable(null);
    } finally {
      setBusy("none");
    }
  }

  async function acceptRecovery(): Promise<void> {
    if (!recoverable) return;
    setBusy("recovery");
    try {
      await restoreHeadRecovery(heldPassword, recoverable);
      setHeldPassword("");
      setRecoverable(null);
      setDamaged(false);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy("none");
    }
  }

  async function biometrics(): Promise<void> {
    setBusy("device");
    setMechanism(null);
    try {
      setMechanism(await unlockWithBiometrics());
    } catch {
      // Falling back to the master password below is always possible.
    } finally {
      setBusy("none");
    }
  }

  return (
    <div className="centered">
      <form className="card auth" onSubmit={submit}>
        <h2>Tresor gesperrt / Vault locked</h2>
        {deviceUnlockAvailable ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => void biometrics()}
              disabled={busy !== "none"}
              data-testid="unlock-biometrics"
            >
              {busy === "device"
                ? "Warten auf dieses Gerät… / Waiting…"
                : "Mit diesem Gerät öffnen / Unlock with this device"}
            </button>
            {mechanism ? (
              <p className="hint" data-testid="unlock-mechanism">
                Entsperrt über / Unlocked via {MECHANISM_LABEL[mechanism] ?? mechanism}
              </p>
            ) : null}
            {mechanism === "uv_gated_local" ? (
              <p className="hint" data-testid="unlock-rank3-warning">
                Rang 3 ist nur ein Policy-Tor: Face ID / Touch ID gibt den lokalen Wrapping-Key frei.
                Das ist keine kryptografische Authenticator-Bindung wie PRF. / Rank 3 is a policy
                gate only: user verification releases a wrapping key stored in this browser. It is
                not a hardware-bound PRF secret.
              </p>
            ) : null}
            <div className="divider">oder / or</div>
          </>
        ) : null}

        {useRecovery ? (
          <label>
            <FieldLabel
              text="Recovery-Schlüssel / Recovery key"
              tip="Ersatz für das Tresor-Passwort. Nicht das Konto-Passwort. / Replaces the vault password. Not the account password."
            />
            <textarea
              value={recovery}
              onChange={(event) => setRecovery(event.target.value)}
              rows={3}
              placeholder="XXXXX-XXXXX-XXXXX-…"
              required
            />
          </label>
        ) : (
          <label>
            <FieldLabel
              text="Tresor-Passwort / Vault password"
              tip="Nur du. Ruhemodus sperrt nicht — nur der Knopf Sperren. / Only you. Sleep does not lock — only the Lock button."
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="master-password"
              required
            />
          </label>
        )}
        <button type="submit" disabled={busy !== "none"} data-testid="unlock-submit">
          {busy === "password" ? "Einen Moment… / One moment…" : "Öffnen / Unlock"}
        </button>
        <button type="button" className="link" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? "Tresor-Passwort / Use the vault password" : "Recovery-Schlüssel / Use the recovery key"}
        </button>
        {damaged ? (
          <section className="card damaged" data-testid="unlock-damaged">
            <p>
              {t({
                de: "Das kann am Passwort liegen — oder der neueste Stand des Tresors ist beschädigt. Von außen sieht beides gleich aus. Die Suche unten probiert dasselbe Passwort auf einem älteren Stand: klappt das, war nicht das Passwort schuld.",
                en: "That may be the password — or the newest state of the vault is damaged. From the outside both look identical. The search below tries this same password against an earlier state: if that opens, the password was not the problem.",
              })}
            </p>
            {!searched ? (
              <button
                type="button"
                className="primary"
                data-testid="find-recovery"
                disabled={busy !== "none"}
                onClick={() => void lookForRecovery()}
              >
                {busy === "recovery"
                  ? t({ de: "Wird gesucht…", en: "Looking…" })
                  : t({ de: "Nach einem heilen Stand suchen", en: "Look for an intact state" })}
              </button>
            ) : recoverable === null ? (
              <p className="error-text" data-testid="no-recovery">
                {t({
                  de: "Kein älterer Stand lässt sich mit diesem Passwort öffnen. Dann war es das Passwort — bitte erneut versuchen oder den Recovery-Schlüssel nehmen.",
                  en: "No earlier state opens with this password. So it was the password — try again, or use the recovery key.",
                })}
              </p>
            ) : (
              <>
                <p data-testid="recovery-found">
                  {t({
                    de: `Heiler Stand vom ${new Date(recoverable.createdAt).toLocaleString()} mit ${String(recoverable.entries.length)} Einträgen.`,
                    en: `Intact state from ${new Date(recoverable.createdAt).toLocaleString()} with ${String(recoverable.entries.length)} entries.`,
                  })}
                </p>
                <p className="hint">
                  {t({
                    de: "Prüfe das Datum. Alles, was nach diesem Stand geändert wurde, ist darin nicht enthalten. Der beschädigte Stand bleibt gespeichert.",
                    en: "Check the date. Anything changed after that state is not in it. The damaged state stays stored.",
                  })}
                </p>
                <button
                  type="button"
                  className="primary"
                  data-testid="accept-recovery"
                  disabled={busy !== "none"}
                  onClick={() => void acceptRecovery()}
                >
                  {t({ de: "Diesen Stand übernehmen", en: "Take this state" })}
                </button>
              </>
            )}
          </section>
        ) : null}
        <p className="hint" data-testid="unlock-hint">
          {deviceUnlockAvailable
            ? "Dieses Gerät kann in einem Schritt entsperren. Das Tresor-Passwort gilt weiter. Ohne Passwort oder Recovery-Kit kein Zurück. / This device can unlock in one step. The vault password still works. No password or recovery kit means no way back."
            : "Öffnen = Tresor-Passwort. Ohne Passwort oder Recovery-Kit kein Zurück — niemand setzt es zurück. / Unlock = vault password. No password or recovery kit means no way back."}
        </p>
      </form>
    </div>
  );
}
