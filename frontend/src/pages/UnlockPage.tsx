import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

const MECHANISM_LABEL: Record<string, string> = {
  prf: "this device",
  large_blob: "this device",
  uv_gated_local: "this device",
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
        <h2>Vault locked</h2>
        {deviceUnlockAvailable ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => void biometrics()}
              disabled={busy !== "none"}
              data-testid="unlock-biometrics"
            >
              {busy === "device" ? "Waiting for this device…" : "Unlock with this device"}
            </button>
            {mechanism ? (
              <p className="hint" data-testid="unlock-mechanism">
                Unlocked via {MECHANISM_LABEL[mechanism] ?? mechanism}
              </p>
            ) : null}
            <div className="divider">or</div>
          </>
        ) : null}

        {useRecovery ? (
          <label>
            Recovery key
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
            Vault password
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
          {busy === "password" ? "Deriving key…" : "Unlock"}
        </button>
        <button type="button" className="link" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? "Use the vault password" : "Use the recovery key"}
        </button>
        <p className="hint">
          {deviceUnlockAvailable
            ? "This device can unlock in one step. The vault password still works on any device."
            : "After you unlock once, you can turn on one-step unlock for this device."}
        </p>
      </form>
    </div>
  );
}
