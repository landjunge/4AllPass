import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "../lib/api.ts";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";

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
  const { signIn, signUp, openThisMac, localMode, localStore } = useApp();
  const { t } = useCopy();
  const remembered = readLastEmail();
  const [mode, setMode] = useState<"sign-in" | "sign-up">(remembered ? "sign-in" : "sign-up");
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState(Boolean(remembered));
  const thisMac = localMode && (localStore?.hasLocalVault ?? false);

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
        setAlready(true);
        setMode("sign-in");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      {thisMac ? (
        <div className="card auth" style={{ marginBottom: "1rem" }}>
          <h2>{t({ de: "Tresor auf diesem Mac", en: "Vault on this Mac" })}</h2>
          <p>
            {t({
              de: `Auf diesem Gerät liegt schon ein Tresor${localStore && localStore.localEntries > 0 ? ` (${localStore.localEntries} Einträge)` : ""}. Nicht neu anlegen — öffnen.`,
              en: `This device already has a vault${localStore && localStore.localEntries > 0 ? ` (${localStore.localEntries} entries)` : ""}. Do not create another — open it.`,
            })}
          </p>
          <button
            type="button"
            className="primary"
            data-testid="open-this-mac"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void openThisMac().finally(() => setBusy(false));
            }}
          >
            {t({ de: "Diesen Tresor öffnen", en: "Open this vault" })}
          </button>
        </div>
      ) : null}
      <form className="card auth" onSubmit={submit}>
        <h2>
          {mode === "sign-up"
            ? t({ de: "Konto anlegen", en: "Create account" })
            : t({ de: "Anmelden", en: "Sign in" })}
        </h2>
        <p className="muted">
          {mode === "sign-in"
            ? t({
                de: "Öffnet den Tresor nicht.",
                en: "This does not open the vault.",
              })
            : t({
                de: "Nur die Anmeldung. Der Tresor kommt als Nächstes.",
                en: "Sign-in only. The vault is next.",
              })}
        </p>
        {already && mode === "sign-in" ? (
          <p className="error-text">
            {t({
              de: "Diese E-Mail gibt es schon. Anmelden — oder Konto erst löschen.",
              en: "This e-mail is already registered. Sign in, or delete the account first.",
            })}
          </p>
        ) : null}
        <label>
          {t({ de: "E-Mail", en: "E-mail" })}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          {t({ de: "Konto-Passwort", en: "Account password" })}
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
          {t({
            de: "Nicht das Tresor-Passwort.",
            en: "Not the vault password.",
          })}
        </p>
        <button type="submit" className="primary" disabled={busy} data-testid="auth-submit">
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
