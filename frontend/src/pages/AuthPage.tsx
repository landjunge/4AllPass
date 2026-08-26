import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../lib/api.ts";
import { useApp } from "../state/app-state.tsx";

const LAST_EMAIL_KEY = "4allpass.last-email";

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(value: string): void {
  try {
    if (value) localStorage.setItem(LAST_EMAIL_KEY, value);
  } catch {
    /* WKWebView storage can throw */
  }
}

export function AuthPage(): ReactNode {
  const { signIn, signUp } = useApp();
  const remembered = readLastEmail();
  const [mode, setMode] = useState<"sign-in" | "sign-up">(remembered ? "sign-in" : "sign-up");
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "sign-in") await signIn(email, password);
      else await signUp(email, password);
      rememberEmail(email);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        rememberEmail(email);
        setMode("sign-in");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <form className="card auth" onSubmit={submit}>
        <img className="logo" src="/logo.png" alt="4AllPass" />
        <h2>
          {mode === "sign-up"
            ? "Konto anlegen / Create account"
            : "Anmelden / Sign in"}
        </h2>
        <p className="muted">
          {mode === "sign-in"
            ? "Anmelden. Das öffnet den Tresor nicht. / Sign in. This does not open the vault."
            : "Zuerst ein Konto, damit dieser Server den verschlüsselten Tresor lagern kann. Das Passwort hier ist nur die Anmeldung. / First an account, so this server can store your encrypted vault. This password is only for signing in."}
        </p>
        <label>
          E-Mail / E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Konto-Passwort / Account password
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
          Anmelde-Passwort und Tresor-Passwort sind verschieden. Das Anmelde-Passwort öffnet den
          Tresor nicht. Niemand auf diesem Server kann das Tresor-Passwort zurücksetzen. /
          Sign-in password and vault password are different. The sign-in password cannot open the
          vault. Nobody on this server can reset the vault password.
        </p>
        <button type="submit" disabled={busy} data-testid="auth-submit">
          {busy
            ? "Einen Moment… / One moment…"
            : mode === "sign-in"
              ? "Anmelden / Sign in"
              : "Konto anlegen / Create account"}
        </button>
        <button
          type="button"
          className="link"
          data-testid="auth-switch"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in"
            ? "Noch kein Konto? / Need an account?"
            : "Schon ein Konto? / Already have an account?"}
        </button>
      </form>
    </div>
  );
}
