import { useState, type FormEvent, type ReactNode } from "react";
import { ARGON2ID_PROFILES } from "@4allpass/crypto";
import type { Argon2idProfileName } from "@4allpass/crypto";
import { useApp } from "../state/app-state.tsx";

const PROFILES: Argon2idProfileName[] = ["mobile_safe", "balanced", "standard", "high"];

export function CreateVaultPage(): ReactNode {
  const { createNewVault } = useApp();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [profile, setProfile] = useState<Argon2idProfileName>("standard");
  const [busy, setBusy] = useState(false);
  const mismatch = repeat.length > 0 && password !== repeat;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try {
      await createNewVault(password, profile);
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
        <h2>Create your vault</h2>
        <p className="muted">
          The master password is the only thing that can open this vault, next to the recovery key.
          It never leaves this device.
        </p>
        <label>
          Master password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={10}
            required
          />
        </label>
        <label>
          Repeat
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            required
          />
        </label>
        {mismatch ? <p className="error-text">The passwords do not match.</p> : null}
        <label>
          Argon2id profile
          <select
            value={profile}
            onChange={(event) => setProfile(event.target.value as Argon2idProfileName)}
          >
            {PROFILES.map((name) => {
              const params = ARGON2ID_PROFILES[name];
              return (
                <option key={name} value={name}>
                  {name} — {Math.round(params.memory / 1024)} MiB, t={params.iterations}, p=
                  {params.parallelism}
                </option>
              );
            })}
          </select>
        </label>
        <p className="hint">
          The parameters are stored inside the master envelope, so they can be upgraded later
          without losing data. Deriving the key takes a moment on purpose.
        </p>
        <button type="submit" disabled={busy || mismatch}>
          {busy ? "Deriving key…" : "Create vault"}
        </button>
      </form>
    </div>
  );
}
