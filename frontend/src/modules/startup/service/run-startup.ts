export interface LocalStoreStatus {
  hasLocalVault: boolean;
  localEntries: number;
  hasOtherAccounts: boolean;
  localVaultId: string | null;
}

interface StartupSession {
  email: string;
}

export interface StartupGateway {
  waitForHealth(): Promise<{ profile: string }>;
  localStatus(): Promise<LocalStoreStatus>;
  localSession(): Promise<StartupSession>;
  me(): Promise<StartupSession>;
}

export interface StartupDependencies {
  gateway: StartupGateway;
  hasToken(): boolean;
  isDesktop(): boolean;
  hasStorageOrigin(): boolean;
  restoreSession(email: string | null): void;
  loadVaults(): Promise<unknown>;
  reportWebviewCapabilities(): Promise<void>;
  setLocalMode(local: boolean): void;
  setLocalStore(status: LocalStoreStatus | null): void;
  setReady(): void;
}

async function restoreAuthenticatedSession(dependencies: StartupDependencies): Promise<void> {
  const account = await dependencies.gateway.me();
  dependencies.restoreSession(account.email);
  await dependencies.loadVaults();
}

/**
 * Runs the existing boot sequence without owning account or vault internals.
 * Health failure keeps the established authenticated-session fallback.
 */
export async function runStartup(dependencies: StartupDependencies): Promise<void> {
  try {
    const health = await dependencies.gateway.waitForHealth();
    const local = health.profile === "local";
    dependencies.setLocalMode(local);

    if (local) {
      try {
        dependencies.setLocalStore(await dependencies.gateway.localStatus());
      } catch {
        dependencies.setLocalStore(null);
      }
    }

    // A normal browser on the local sidecar keeps its silent storage session.
    // The bundled desktop starts on account authentication instead.
    if (
      local &&
      !dependencies.hasToken() &&
      !dependencies.isDesktop() &&
      !dependencies.hasStorageOrigin()
    ) {
      const session = await dependencies.gateway.localSession();
      dependencies.restoreSession(session.email);
      await dependencies.loadVaults();
      void dependencies.reportWebviewCapabilities().catch(() => undefined);
      return;
    }

    if (dependencies.hasToken()) {
      await restoreAuthenticatedSession(dependencies);
    }
  } catch {
    if (dependencies.hasToken()) {
      try {
        await restoreAuthenticatedSession(dependencies);
      } catch {
        dependencies.restoreSession(null);
      }
    } else {
      dependencies.restoreSession(null);
    }
  } finally {
    dependencies.setReady();
  }
}
