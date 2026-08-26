import { useState, type ReactNode } from "react";
import { useApp } from "./state/app-state.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { CreateVaultPage } from "./pages/CreateVaultPage.tsx";
import { RestoreVaultPage } from "./pages/RestoreVaultPage.tsx";
import { UnlockPage } from "./pages/UnlockPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";
import { WelcomePage } from "./pages/WelcomePage.tsx";
import { RecoveryKitDialog } from "./components/RecoveryKitDialog.tsx";

export function App(): ReactNode {
  const {
    ready,
    email,
    localMode,
    vaults,
    lockState,
    error,
    notice,
    recoveryKey,
    clearMessages,
    lock,
    signOut,
  } = useApp();
  const [welcomeMode, setWelcomeMode] = useState<"home" | "create" | "restore">("home");

  if (!ready) {
    return (
      <div className="centered">
        <p className="muted">Laden… / Loading…</p>
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
            {localMode ? null : (
              <span className="muted small" data-testid="account-email">
                {email}
              </span>
            )}
            <span className="sr-only" data-testid="lock-state">
              {lockState}
            </span>
            <span className="lock-pill" aria-hidden="true">
              {lockState === "UNLOCKED" ? "🔓 Tresor geöffnet" : "🔒 Gesperrt"}
            </span>
            {lockState === "UNLOCKED" ? (
              <button type="button" className="primary" onClick={lock} data-testid="lock">
                Sperren
              </button>
            ) : null}
            {localMode ? null : (
              <button type="button" className="link" onClick={() => void signOut()}>
                Abmelden / Sign out
              </button>
            )}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="banner error" role="alert" data-testid="error-banner">
          <span>{error}</span>
          <button type="button" className="link" onClick={clearMessages}>
            Schließen / Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner notice" data-testid="notice-banner">
          <span>{notice}</span>
          <button type="button" className="link" onClick={clearMessages}>
            Schließen / Dismiss
          </button>
        </div>
      ) : null}

      <main>
        {!email ? (
          <AuthPage />
        ) : vaults.length === 0 && localMode && welcomeMode === "home" ? (
          <WelcomePage
            onCreate={() => setWelcomeMode("create")}
            onRestore={() => setWelcomeMode("restore")}
          />
        ) : vaults.length === 0 && localMode && welcomeMode === "restore" ? (
          <RestoreVaultPage onBack={() => setWelcomeMode("home")} />
        ) : vaults.length === 0 && localMode ? (
          <CreateVaultPage onBack={() => setWelcomeMode("home")} />
        ) : vaults.length === 0 ? (
          <CreateVaultPage />
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
