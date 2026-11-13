import type { VaultSummary } from "../../../lib/api.ts";
import { isOfflineError } from "../../../lib/snapshot-cache.ts";
import { loadOfflineBootstrap } from "../../../lib/offline-bootstrap.ts";

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
  loadVaults(): Promise<VaultSummary[]>;
  restoreOffline(email: string, vaults: VaultSummary[]): void;
  saveOfflineBootstrap(email: string, vaults: VaultSummary[]): void;
  reportWebviewCapabilities(): Promise<void>;
  setLocalMode(local: boolean): void;
  setLocalStore(status: LocalStoreStatus | null): void;
  setReady(): void;
}

async function restoreAuthenticatedSession(dependencies: StartupDependencies): Promise<void> {
  const account = await dependencies.gateway.me();
  dependencies.restoreSession(account.email);
  const vaults = await dependencies.loadVaults();
  dependencies.saveOfflineBootstrap(account.email, vaults);
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
      const vaults = await dependencies.loadVaults();
      dependencies.saveOfflineBootstrap(session.email, vaults);
      void dependencies.reportWebviewCapabilities().catch(() => undefined);
      return;
    }

    if (dependencies.hasToken()) {
      await restoreAuthenticatedSession(dependencies);
    }
  } catch (error) {
    // Only a transport failure (no HTTP answer) may use the metadata fallback.
    // 401/403/404/409/422/5xx stay server answers and never become "offline".
    if (dependencies.hasToken() && isOfflineError(error)) {
      const cached = loadOfflineBootstrap();
      if (cached) {
        dependencies.restoreSession(cached.email);
        dependencies.restoreOffline(cached.email, cached.vaults);
        return;
      }
    }
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
