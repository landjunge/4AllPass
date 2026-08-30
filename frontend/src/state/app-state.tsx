/**
 * App state and the lock lifecycle of crypto-protocol.md §10.
 *
 * LOCKED → UNLOCKING → UNLOCKED → LOCKING → LOCKED. Leaving UNLOCKED zeroizes
 * the Vault Key and clears plaintext. Only the Lock button locks. Sleep, idle,
 * a hidden tab, and switching to Chrome do not.
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
import { readStorageOrigin } from "../lib/storage-origin.ts";
import { clearCopiedSecret } from "../lib/clipboard.ts";
import { openSharePackage } from "../lib/share.ts";
import { deviceId } from "../lib/device-identity.ts";
import { isTauriShell, probeWebviewWebauthn } from "../lib/webauthnCapabilities.ts";
import { readActiveVaultId, writeActiveVaultId } from "../lib/active-vault.ts";
import { mergeImportedLogins } from "../lib/import.ts";
import { decryptVaultEntries } from "../lib/pull-other-vault.ts";
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

interface LocalStoreStatus {
  hasLocalVault: boolean;
  localEntries: number;
  hasOtherAccounts: boolean;
  localVaultId: string | null;
}

interface AppState {
  ready: boolean;
  email: string | null;
  localMode: boolean;
  localStore: LocalStoreStatus | null;
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
  openThisMac(): Promise<void>;
  signOut(): Promise<void>;
  selectVault(vaultId: string): Promise<void>;
  createNewVault(masterPassword: string, profile?: Argon2idProfileName): Promise<void>;
  restoreFromShare(fileText: string, shareKey: string, masterPassword: string): Promise<void>;
  unlockWithPassword(masterPassword: string): Promise<void>;
  unlockWithRecovery(recoveryKey: string): Promise<void>;
  unlockWithBiometrics(): Promise<DeviceUnlockMechanism>;
  lock(): void;
  pullLocalIntoOpenVault(masterPassword: string): Promise<void>;
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
  const [localStore, setLocalStore] = useState<LocalStoreStatus | null>(null);
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
    let next: string | null = null;
    setActiveVaultId((current) => {
      const remembered = current ?? readActiveVaultId();
      next =
        remembered && list.some((row) => row.vaultId === remembered)
          ? remembered
          : (list[0]?.vaultId ?? null);
      writeActiveVaultId(next);
      return next;
    });
    if (next) setDeviceUnlockAvailable(await hasDeviceUnlock(next));
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const health = await api.waitForHealth();
        const local = health.profile === "local";
        setLocalMode(local);
        if (local) {
          try {
            setLocalStore(await api.localStatus());
          } catch {
            setLocalStore(null);
          }
        }
        // Browser on :8788 keeps the silent local session (e2e / npm run app).
        // The desktop window shows Konto anlegen first — no auto-login.
        if (local && !getToken() && !isTauriShell() && !readStorageOrigin()) {
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

      async openThisMac() {
        await withStatus(async () => {
          const session = await api.localSession();
          setEmail(session.email);
          await loadVaults();
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
        writeActiveVaultId(vaultId);
        setDeviceUnlockAvailable(await hasDeviceUnlock(vaultId));
      },

      async createNewVault(masterPassword, profile = "mobile_safe") {
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            const created = await createVault(masterPassword, profile);
            setActiveVaultId(created.vault.vaultId);
            writeActiveVaultId(created.vault.vaultId);
            setUnlocked(created.vault);
            setRecoveryKey(created.recoveryKey);
            await loadVaults();
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        }, "Tresor angelegt. Recovery-Schlüssel jetzt sichern. / Vault created. Store the recovery key now.");
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
            writeActiveVaultId(next.vaultId);
            setUnlocked(next);
            setRecoveryKey(created.recoveryKey);
            await loadVaults();
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        }, "Tresor aus Share-Datei wiederhergestellt. Neuen Recovery-Schlüssel sichern. Der Share-Schlüssel ist das nicht. / Vault restored from share file. Store the new recovery key. The share key is not this key.");
      },

      async unlockWithPassword(masterPassword) {
        if (!activeVaultId) throw new Error("no vault selected");
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            setUnlocked(await unlockWithMasterPassword(activeVaultId, masterPassword));
            writeActiveVaultId(activeVaultId);
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
            writeActiveVaultId(activeVaultId);
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
            writeActiveVaultId(activeVaultId);
            return unlocked.unlockedWith as DeviceUnlockMechanism;
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        });
      },

      lock,

      async pullLocalIntoOpenVault(masterPassword) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        const keepId = current.vaultId;
        await withStatus(async () => {
          const status = await api.localStatus();
          const adopted = status.hasLocalVault
            ? await api.adoptLocalVault()
            : { vaultId: null as string | null, entries: 0 };
          const listed = await api.listVaults();
          const sourceId =
            adopted.vaultId ??
            status.localVaultId ??
            listed.find((row) => row.vaultId !== keepId)?.vaultId ??
            null;
          if (!sourceId || sourceId === keepId) {
            throw new Error("no other vault on this Mac");
          }
          const incoming = await decryptVaultEntries(sourceId, masterPassword);
          const merged = mergeImportedLogins(current.entries, incoming);
          writeActiveVaultId(keepId);
          setActiveVaultId(keepId);
          setUnlocked(await commitEntries(current, merged));
          setLocalStore({
            hasLocalVault: false,
            localEntries: 0,
            hasOtherAccounts: true,
            localVaultId: null,
          });
        }, "Einträge übernommen. Dieser Tresor bleibt offen. / Entries pulled in. This vault stays open.");
      },

      async saveEntries(entries) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          setUnlocked(await commitEntries(current, entries));
        }, "Gespeichert. / Saved.");
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
        }, "Geräte-Entsperren ist an. Das Tresor-Passwort gilt weiter. / Device unlock enabled. The vault password still works.");
      },

      async revoke(targetDeviceId) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          setUnlocked(await revokeDevice(current, targetDeviceId));
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) setDeviceUnlockAvailable(false);
        }, "Aus dem nächsten Sync genommen. Ein Gerät, das diesen Tresor-Schlüssel schon kennt, kennt ihn weiter. / Removed from the next sync. A device that already knows this vault key still knows it.");
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
        }, "Tresor-Schlüssel gewechselt. Alte Stände lesbar nur für Inhaber des vorigen Schlüssels. / Vault key rotated. Old snapshots stay readable only to holders of the previous key.");
      },

      async replaceTrustedRecovery(oldRecoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw new Error("vault is locked");
        await withStatus(async () => {
          const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText);
          setUnlocked(next.vault);
          setRecoveryKey(next.recoveryKey);
        }, "Neuer Recovery-Schlüssel gedruckt. Der alte öffnet diesen Stand nicht mehr. / New recovery key printed. The previous kit no longer opens this revision.");
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
        }, "Tresor-Schlüssel gewechselt, weil das Recovery-Kit gestohlen sein kann. Neuen Schlüssel sichern. / Vault key rotated because the recovery kit may be stolen. Save the new kit.");
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
      localStore,
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
      localStore,
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
