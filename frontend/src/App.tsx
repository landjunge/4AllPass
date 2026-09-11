import { useState, type ReactNode } from "react";
import { useApp } from "./state/app-state.tsx";
import { useCopy } from "./state/copy-mode.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { CreateVaultPage } from "./pages/CreateVaultPage.tsx";
import { RestoreVaultPage } from "./pages/RestoreVaultPage.tsx";
import { UnlockPage } from "./pages/UnlockPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";
import { RecoveryKitDialog } from "./components/RecoveryKitDialog.tsx";
import { PullLocalVaultBanner } from "./components/vault/PullLocalVaultBanner.tsx";

export function App(): ReactNode {
  const {
    ready,
    email,
    vaults,
    lockState,
    error,
    notice,
    recoveryKey,
    clearMessages,
    lock,
    signOut,
  } = useApp();
  const { t } = useCopy();
  const [emptyMode, setEmptyMode] = useState<"create" | "restore">("create");

  if (!ready) {
    return (
      <div className="centered">
        <p className="muted">{t({ de: "Laden…", en: "Loading…" })}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <span className="brand">
          <img src="/logo.png" alt="4AllPass" />
        </span>
        {email ? (
          <div className="header-actions">
            {email === "local@127.0.0.1" ? null : (
              <span className="muted small" data-testid="account-email">
                {email}
              </span>
            )}
            <span className="sr-only" data-testid="lock-state">
              {lockState}
            </span>
            {vaults.length > 0 ? (
              <span className="lock-pill" aria-hidden="true">
                {lockState === "UNLOCKED"
                  ? t({ de: "🔓 Tresor geöffnet", en: "Vault open" })
                  : t({ de: "🔒 Gesperrt", en: "Locked" })}
              </span>
            ) : null}
            {lockState === "UNLOCKED" ? (
              <button type="button" className="primary" onClick={lock} data-testid="lock">
                {t({ de: "Sperren", en: "Lock" })}
              </button>
            ) : null}
            {email !== "local@127.0.0.1" ? (
              <button type="button" className="link" onClick={() => void signOut()}>
                {t({ de: "Abmelden", en: "Sign out" })}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="banner error" role="alert" data-testid="error-banner">
          <span>{t(error.userText)}</span>
          <button type="button" className="link" onClick={clearMessages}>
            {t({ de: "Schließen", en: "Dismiss" })}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner notice" data-testid="notice-banner">
          <span>{t(notice.userText)}</span>
          <button type="button" className="link" onClick={clearMessages}>
            {t({ de: "Schließen", en: "Dismiss" })}
          </button>
        </div>
      ) : null}
      {email && email !== "local@127.0.0.1" ? <PullLocalVaultBanner /> : null}

      <main>
        {!email ? (
          <AuthPage />
        ) : vaults.length === 0 && emptyMode === "restore" ? (
          <RestoreVaultPage onBack={() => setEmptyMode("create")} />
        ) : vaults.length === 0 ? (
          <CreateVaultPage onRestore={() => setEmptyMode("restore")} />
        ) : lockState === "UNLOCKED" ? (
          <VaultPage />
        ) : (
          <UnlockPage />
        )}
      </main>

      {recoveryKey ? <RecoveryKitDialog /> : null}
    </div>
  );
}
