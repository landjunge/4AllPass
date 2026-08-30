import { useState, type ReactNode } from "react";
import { useApp } from "./state/app-state.tsx";
import { AuthPage } from "./pages/AuthPage.tsx";
import { CreateVaultPage } from "./pages/CreateVaultPage.tsx";
import { RestoreVaultPage } from "./pages/RestoreVaultPage.tsx";
import { UnlockPage } from "./pages/UnlockPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";
import { RecoveryKitDialog } from "./components/RecoveryKitDialog.tsx";

export function App(): ReactNode {
  const {
    ready,
    email,
    localMode,
    localStore,
    vaults,
    lockState,
    error,
    notice,
    recoveryKey,
    clearMessages,
    lock,
    signOut,
  } = useApp();
  const [emptyMode, setEmptyMode] = useState<"create" | "restore">("create");

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
            {localMode && email === "local@127.0.0.1" ? null : (
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
                  ? "🔓 Tresor geöffnet / Vault open"
                  : "🔒 Gesperrt / Locked"}
              </span>
            ) : null}
            {lockState === "UNLOCKED" ? (
              <button type="button" className="primary" onClick={lock} data-testid="lock">
                Sperren / Lock
              </button>
            ) : null}
            {email !== "local@127.0.0.1" ? (
              <button type="button" className="link" onClick={() => void signOut()}>
                Abmelden / Sign out
              </button>
            ) : null}
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
      {email && email !== "local@127.0.0.1" && localStore?.hasLocalVault ? (
        <div className="banner notice" data-testid="other-vault-banner">
          <span>
            {localStore.localEntries > 0
              ? `Auf diesem Mac liegt noch der lokale Tresor (${localStore.localEntries} Einträge). Nicht neu anlegen — abmelden und den öffnen. / This Mac still has the local vault (${localStore.localEntries} entries). Do not create another — sign out and open it.`
              : `Auf diesem Mac liegt noch ein lokaler Tresor. Nicht neu anlegen. / This Mac still has a local vault. Do not create another.`}
          </span>
          <button type="button" className="link" onClick={() => void signOut()}>
            Abmelden / Sign out
          </button>
        </div>
      ) : null}

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
