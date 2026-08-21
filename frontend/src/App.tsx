import type { ReactNode } from "react";
import { useApp } from "./state/app-state.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { CreateVaultPage } from "./pages/CreateVaultPage.tsx";
import { UnlockPage } from "./pages/UnlockPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";
import { RecoveryKitDialog } from "./components/RecoveryKitDialog.tsx";

export function App(): ReactNode {
  const { ready, email, vaults, lockState, error, notice, recoveryKey, clearMessages, lock, signOut } =
    useApp();

  if (!ready) {
    return (
      <div className="centered">
        <p className="muted">Loading…</p>
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
            <span className="muted small" data-testid="account-email">
              {email}
            </span>
            <span className="state" data-testid="lock-state">
              {lockState}
            </span>
            {lockState === "UNLOCKED" ? (
              <button type="button" onClick={lock} data-testid="lock">
                Lock
              </button>
            ) : null}
            <button type="button" className="link" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="banner error" role="alert" data-testid="error-banner">
          <span>{error}</span>
          <button type="button" className="link" onClick={clearMessages}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner notice" data-testid="notice-banner">
          <span>{notice}</span>
          <button type="button" className="link" onClick={clearMessages}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main>
        {!email ? (
          <AuthPage />
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
