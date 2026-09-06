import { useEffect, useMemo, useState } from "react";

import { api, getToken } from "../../../lib/api.ts";
import { readStorageOrigin } from "../../../lib/storage-origin.ts";
import {
  isTauriShell,
  probeWebviewWebauthn,
} from "../../../lib/webauthnCapabilities.ts";
import { runStartup, type LocalStoreStatus } from "../service/run-startup.ts";

export interface UseStartupOptions {
  restoreSession(email: string | null): void;
  loadVaults(): Promise<unknown>;
}

export interface StartupState {
  ready: boolean;
  localMode: boolean;
  localStore: LocalStoreStatus | null;
  updateLocalStore(status: LocalStoreStatus | null): void;
}

export function useStartup(options: UseStartupOptions): StartupState {
  const { restoreSession, loadVaults } = options;
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
      async reportWebviewCapabilities() {
        await api.reportWebviewCaps(await probeWebviewWebauthn());
      },
      setLocalMode,
      setLocalStore,
      setReady: () => setReady(true),
    });
  }, [loadVaults, restoreSession]);

  return useMemo(
    () => ({ ready, localMode, localStore, updateLocalStore: setLocalStore }),
    [localMode, localStore, ready],
  );
}
