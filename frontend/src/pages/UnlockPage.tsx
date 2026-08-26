import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

const MECHANISM_LABEL: Record<string, string> = {
  prf: "WebAuthn PRF (rank 1)",
  large_blob: "WebAuthn largeBlob (rank 2)",
  uv_gated_local: "UV-gated local store (rank 3 — policy only)",
};

export function UnlockPage(): ReactNode {
  const { unlockWithPassword, unlockWithRecovery, unlockWithBiometrics, deviceUnlockAvailable } =
    useApp();
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState<"none" | "password" | "device">("none");
  const [mechanism, setMechanism] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy("password");
    try {
      if (useRecovery) await unlockWithRecovery(recovery);
      else await unlockWithPassword(password);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy("none");
      setPassword("");
      setRecovery("");
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
            Recovery-Schlüssel / Recovery key
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
            Tresor-Passwort / Vault password
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
        <p className="hint" data-testid="unlock-hint">
          {deviceUnlockAvailable
            ? "Dieses Gerät kann in einem Schritt entsperren. Das Tresor-Passwort gilt weiter. Ohne Passwort oder Recovery-Kit kein Zurück. / This device can unlock in one step. The vault password still works. No password or recovery kit means no way back."
            : "Öffnen = Tresor-Passwort. Ohne Passwort oder Recovery-Kit kein Zurück — niemand setzt es zurück. / Unlock = vault password. No password or recovery kit means no way back."}
        </p>
      </form>
    </div>
  );
}
