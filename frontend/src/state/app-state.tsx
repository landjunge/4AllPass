/**
 * App state and the lock lifecycle of crypto-protocol.md §10.
 *
 * LOCKED → UNLOCKING → UNLOCKED → LOCKING → LOCKED. Leaving UNLOCKED zeroizes
 * the Vault Key and clears plaintext. Desktop app: manual lock or sleep.
 * PWA: inactivity and a hidden tab. Tray hide does not lock.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, getToken, type DeviceSummary, type VaultSummary } from "../lib/api.ts";
import { clearCopiedSecret } from "../lib/clipboard.ts";
import { openSharePackage } from "../lib/share.ts";
import { deviceId } from "../lib/device-identity.ts";
import { listenDesktopLock } from "../lib/desktop.ts";
import { isTauriShell, probeWebviewWebauthn } from "../lib/webauthnCapabilities.ts";
import type { VaultEntry } from "../lib/entries.ts";
import {
  commitEntries,
  createVault,
  enableDeviceUnlockForVault,
  hardRevokeDevice,
  hasDeviceUnlock,
  lock as lockVault,
  replaceTrustedRecoveryKey,
  revokeDevice,
  rotateCompromisedRecovery,
  unlockWithDevice,
  unlockWithMasterPassword,
  unlockWithRecoveryKey,
  type UnlockedVault,
} from "../lib/vault-session.ts";
import type { Argon2idProfileName } from "@4allpass/crypto";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

export type LockState = "LOCKED" | "UNLOCKING" | "UNLOCKED" | "LOCKING";

export const AUTO_LOCK_MS = 5 * 60 * 1000;

interface AppState {
  ready: boolean;
  email: string | null;
  localMode: boolean;
  vaults: VaultSummary[];
  activeVaultId: string | null;
  lockState: LockState;
  vault: UnlockedVault | null;
  devices: DeviceSummary[];
  deviceUnlockAvailable: boolean;
  thisDeviceId: string;
  error: string | null;
  notice: string | null;
  recoveryKey: string | null;
}

interface AppActions {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  selectVault(vaultId: string): Promise<void>;
  createNewVault(masterPassword: string, profile?: Argon2idProfileName): Promise<void>;
  restoreFromShare(fileText: string, shareKey: string, masterPassword: string): Promise<void>;
  unlockWithPassword(masterPassword: string): Promise<void>;
  unlockWithRecovery(recoveryKey: string): Promise<void>;
  unlockWithBiometrics(): Promise<DeviceUnlockMechanism>;
  lock(): void;
  saveEntries(entries: VaultEntry[]): Promise<void>;
  enableBiometrics(): Promise<DeviceUnlockMechanism>;
  revoke(targetDeviceId: string): Promise<void>;
  hardRevoke(
    targetDeviceId: string,
    masterPassword: string,
    recoveryKeyText?: string,
  ): Promise<void>;
  replaceTrustedRecovery(oldRecoveryKeyText: string): Promise<void>;
  rotateCompromisedRecovery(masterPassword: string, previousRecoveryKeyText?: string): Promise<void>;
  refreshDevices(): Promise<void>;
  dismissRecoveryKey(): void;
  clearMessages(): void;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function useApp(): AppState & AppActions {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>("LOCKED");
  const [vault, setVault] = useState<UnlockedVault | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [deviceUnlockAvailable, setDeviceUnlockAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const vaultRef = useRef<UnlockedVault | null>(null);

  const setUnlocked = useCallback((next: UnlockedVault | null) => {
    vaultRef.current = next;
    setVault(next);
    setLockState(next ? "UNLOCKED" : "LOCKED");
  }, []);

  const lock = useCallback(() => {
    if (!vaultRef.current) return;
    setLockState("LOCKING");
    lockVault(vaultRef.current);
    vaultRef.current = null;
    setVault(null);
    setLockState("LOCKED");
    void clearCopiedSecret().catch(() => undefined);
  }, []);

  const loadVaults = useCallback(async (): Promise<VaultSummary[]> => {
    const list = await api.listVaults();
    setVaults(list);
    const first = list[0]?.vaultId ?? null;
    setActiveVaultId((current) => current ?? first);
    if (first) setDeviceUnlockAvailable(await hasDeviceUnlock(first));
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const health = await api.health();
        const local = health.profile === "local";
        setLocalMode(local);
        if (local && !getToken()) {
          const session = await api.localSession();
          setEmail(session.email);
          await loadVaults();
          void probeWebviewWebauthn()
            .then((caps) => api.reportWebviewCaps(caps))
            .catch(() => undefined);
          return;
        }
        if (getToken()) {
          const account = await api.me();
          setEmail(account.email);
          await loadVaults();
        }
      } catch {
        if (getToken()) {
          try {
            const account = await api.me();
            setEmail(account.email);
            await loadVaults();
          } catch {
            setEmail(null);
          }
        } else {
          setEmail(null);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [loadVaults]);

  // Desktop: only the Lock button and OS sleep (`desktop-lock`). No idle timer,
  // no screen-lock, no tray-hide. PWA: inactivity + hidden tab (crypto-protocol.md §10).
  useEffect(() => {
    if (lockState !== "UNLOCKED") return;
    const desktop = localMode && isTauriShell();
    let timer: number | undefined;
    const events = ["pointerdown", "keydown", "focus"] as const;
    const reset = (): void => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    const onVisibility = (): void => {
      if (desktop) return;
      if (document.visibilityState === "hidden") lock();
    };
    if (!desktop) {
      timer = window.setTimeout(lock, AUTO_LOCK_MS);
      for (const event of events) window.addEventListener(event, reset);
      document.addEventListener("visibilitychange", onVisibility);
    }
    let cancelled = false;
    let unlistenLock: (() => void) | undefined;
    void listenDesktopLock(lock).then((fn) => {
      if (cancelled) fn();
      else unlistenLock = fn;
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (!desktop) {
        for (const event of events) window.removeEventListener(event, reset);
        document.removeEventListener("visibilitychange", onVisibility);
      }
      unlistenLock?.();
    };
  }, [lockState, lock, localMode]);

  const withStatus = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T> => {
      setError(null);
      try {
        const result = await action();
        if (success) setNotice(success);
        return result;
      } catch (failure) {
        setError(describeError(failure));
        throw failure;
      }
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    if (!activeVaultId) return;
    setDevices(await api.listDevices(activeVaultId));
  }, [activeVaultId]);

  const actions: AppActions = useMemo(
    () => ({
      async signIn(userEmail, password) {
        await withStatus(async () => {
          const session = await api.login(userEmail, password);
          setEmail(session.email);
          await loadVaults();
        });
      },

      async signUp(userEmail, password) {
        await withStatus(async () => {
          const session = await api.register(userEmail, password);
          setEmail(session.email);
          setVaults([]);
        });
      },

      async signOut() {
        lock();
        await api.logout();
        setEmail(null);
        setVaults([]);
        setActiveVaultId(null);
        setDevices([]);
      },

      async selectVault(vaultId) {
        lock();
        setActiveVaultId(vaultId);
        setDeviceUnlockAvailable(await hasDeviceUnlock(vaultId));
      },

      async createNewVault(masterPassword, profile = "mobile_safe") {
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            const created = await createVault(masterPassword, profile);
            setActiveVaultId(created.vault.vaultId);
            setUnlocked(created.vault);
            setRecoveryKey(created.recoveryKey);
            await loadVaults();
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        }, "Vault created. Store the recovery key now.");
      },

      async restoreFromShare(fileText, shareKey, masterPassword) {
        await withStatus(async () => {
          const entries = openSharePackage(fileText, shareKey);
          if (entries.length === 0) throw new Error("share file has no entries");
          setLockState("UNLOCKING");
          try {
            const created = await createVault(masterPassword, "mobile_safe");
            const next = await commitEntries(created.vault, entries);
            setActiveVaultId(next.vaultId);
            setUnlocked(next);
            setRecoveryKey(created.recoveryKey);
            await loadVaults();
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        }, "Vault restored from share file. Store the new recovery key. The share key is not this key.");
      },

      async unlockWithPassword(masterPassword) {
        if (!activeVaultId) throw new Error("no vault selected");
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            setUnlocked(await unlockWithMasterPassword(activeVaultId, masterPassword));
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        });
      },

      async unlockWithRecovery(key) {
        if (!activeVaultId) throw new Error("no vault selected");
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            setUnlocked(await unlockWithRecoveryKey(activeVaultId, key));
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        });
      },

      async unlockWithBiometrics() {
        if (!activeVaultId) throw new Error("no vault selected");
        return withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            const unlocked = await unlockWithDevice(activeVaultId);
            setUnlocked(unlocked);
            return unlocked.unlockedWith as DeviceUnlockMechanism;
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        });
      },

      lock,

      async saveEntries(entries) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          setUnlocked(await commitEntries(current, entries));
        }, "Saved.");
      },

      async enableBiometrics() {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        if (!email) throw new Error("not signed in");
        return withStatus(async () => {
          const result = await enableDeviceUnlockForVault(current, email);
          setUnlocked(result.vault);
          setDeviceUnlockAvailable(true);
          setDevices(await api.listDevices(current.vaultId));
          return result.mechanism;
        }, "Device unlock enabled. The master password still works.");
      },

      async revoke(targetDeviceId) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          setUnlocked(await revokeDevice(current, targetDeviceId));
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) setDeviceUnlockAvailable(false);
        }, "Removed from the next sync. A device that already knows this vault key still knows it.");
      },

      async hardRevoke(targetDeviceId, masterPassword, recoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          const next = await hardRevokeDevice(current, {
            targetDeviceId,
            masterPassword,
            ...(recoveryKeyText ? { recoveryKeyText } : {}),
          });
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) {
            setUnlocked(null);
            setDeviceUnlockAvailable(false);
          } else {
            setUnlocked(next);
            if (!next.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
              setDeviceUnlockAvailable(false);
            }
          }
        }, "Vault key rotated. Old snapshots stay readable only to holders of the previous key.");
      },

      async replaceTrustedRecovery(oldRecoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText);
          setUnlocked(next.vault);
          setRecoveryKey(next.recoveryKey);
        }, "New recovery key printed. The previous kit no longer opens this revision.");
      },

      async rotateCompromisedRecovery(masterPassword, previousRecoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          const next = await rotateCompromisedRecovery(current, {
            masterPassword,
            ...(previousRecoveryKeyText ? { previousRecoveryKeyText } : {}),
          });
          setUnlocked(next.vault);
          setRecoveryKey(next.recoveryKey);
          if (!next.vault.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
            setDeviceUnlockAvailable(false);
          }
        }, "Vault key rotated because the recovery kit may be stolen. Save the new kit.");
      },

      refreshDevices,

      dismissRecoveryKey() {
        setRecoveryKey(null);
      },

      clearMessages() {
        setError(null);
        setNotice(null);
      },
    }),
    [activeVaultId, email, loadVaults, lock, refreshDevices, setUnlocked, withStatus],
  );

  const value = useMemo(
    () => ({
      ready,
      email,
      localMode,
      vaults,
      activeVaultId,
      lockState,
      vault,
      devices,
      deviceUnlockAvailable,
      thisDeviceId: deviceId(),
      error,
      notice,
      recoveryKey,
      ...actions,
    }),
    [
      ready,
      email,
      localMode,
      vaults,
      activeVaultId,
      lockState,
      vault,
      devices,
      deviceUnlockAvailable,
      error,
      notice,
      recoveryKey,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
