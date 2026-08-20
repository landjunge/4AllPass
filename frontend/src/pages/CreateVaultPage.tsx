import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

export function CreateVaultPage(): ReactNode {
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
        <h2>Create your vault</h2>
        <p className="muted">
          Choose a vault password. If you forget it, only the recovery key on the next screen can
          open this vault. Nobody can reset it for you — not even this server.
        </p>
        <label>
          Vault password
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
        <p className="hint">
          The vault password never leaves this device. Setup takes a few seconds on purpose.
        </p>
        <button type="submit" disabled={busy || mismatch}>
          {busy ? "Creating vault…" : "Create vault"}
        </button>
      </form>
    </div>
  );
}
