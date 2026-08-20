import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";

export function AuthPage(): ReactNode {
  const { signIn, signUp } = useApp();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "sign-in") await signIn(email, password);
      else await signUp(email, password);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <form className="card auth" onSubmit={submit}>
        <h1>4AllPass</h1>
        <p className="muted">
          {mode === "sign-in"
            ? "Sign in to your account. This does not open the vault."
            : "Create an account so this server can store your encrypted vault. The password below is only for signing in."}
        </p>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Account password
          <input
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={mode === "sign-up" ? 12 : 1}
            required
          />
        </label>
        <p className="hint">
          Sign-in password and vault password are different. The sign-in password cannot open your
          vault, and nobody on this server can reset the vault password.
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in" ? "Need an account?" : "Already have an account?"}
        </button>
      </form>
    </div>
  );
}
