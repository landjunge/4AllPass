import { useEffect, useMemo, useState } from "react";

import { api, getToken } from "../../../lib/api.ts";
import { readStorageOrigin } from "../../../lib/storage-origin.ts";
import {
  isTauriShell,
  probeWebviewWebauthn,
} from "../../../lib/webauthnCapabilities.ts";
import { runStartup, type LocalStoreStatus } from "../service/run-startup.ts";
import {
  fingerprintSessionToken,
  loadOfflineBootstrap,
  saveOfflineBootstrap,
  type OfflineBootstrapBinding,
} from "../../../lib/offline-bootstrap.ts";
import type { VaultSummary } from "../../../lib/api.ts";

/** Binding of the metadata cache to the current bearer session and origin. */
async function currentBinding(): Promise<OfflineBootstrapBinding | null> {
  const token = getToken();
  if (!token) return null;
  return {
    sessionFingerprint: await fingerprintSessionToken(token),
    storageOrigin: readStorageOrigin(),
  };
}

export interface UseStartupOptions {
  restoreSession(email: string | null): void;
  loadVaults(): Promise<VaultSummary[]>;
  restoreOffline(email: string, vaults: VaultSummary[]): void;
}

export interface StartupState {
  ready: boolean;
  localMode: boolean;
  localStore: LocalStoreStatus | null;
  updateLocalStore(status: LocalStoreStatus | null): void;
}

export function useStartup(options: UseStartupOptions): StartupState {
  const { restoreSession, loadVaults, restoreOffline } = options;
  const [ready, setReady] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const [localStore, setLocalStore] = useState<LocalStoreStatus | null>(null);

  useEffect(() => {
    void runStartup({
      gateway: api,
      hasToken: () => Boolean(getToken()),
      isDesktop: isTauriShell,
      hasStorageOrigin: () => Boolean(readStorageOrigin()),
      restoreSession,
      loadVaults,
      restoreOffline,
      async saveOfflineBootstrap(email, vaults) {
        const binding = await currentBinding();
        if (binding) await saveOfflineBootstrap(email, vaults, binding);
      },
      async loadOfflineBootstrap() {
        const binding = await currentBinding();
        return binding ? loadOfflineBootstrap(binding) : null;
      },
      async reportWebviewCapabilities() {
        await api.reportWebviewCaps(await probeWebviewWebauthn());
      },
      setLocalMode,
      setLocalStore,
      setReady: () => setReady(true),
    });
  }, [loadVaults, restoreOffline, restoreSession]);

  return useMemo(
    () => ({ ready, localMode, localStore, updateLocalStore: setLocalStore }),
    [localMode, localStore, ready],
  );
}
