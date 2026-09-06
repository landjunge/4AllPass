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
  useReducer,
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
import { passwordsAreSame } from "../lib/password-separation.ts";
import {
  feedbackError,
  feedbackReducer,
  initialFeedbackState,
  type ErrorFeedback,
  type NoticeCode,
  type NoticeFeedback,
} from "../modules/feedback/index.ts";
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
  error: ErrorFeedback | null;
  notice: NoticeFeedback | null;
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
  passwordsCollide(vaultPassword: string): boolean;
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
  const [feedback, dispatchFeedback] = useReducer(feedbackReducer, initialFeedbackState);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const vaultRef = useRef<UnlockedVault | null>(null);
  const accountPasswordRef = useRef<string | null>(null);

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
    async <T,>(action: () => Promise<T>, success?: NoticeCode): Promise<T> => {
      dispatchFeedback({ type: "action_started" });
      try {
        const result = await action();
        if (success) dispatchFeedback({ type: "notice", code: success });
        return result;
      } catch (failure) {
        dispatchFeedback({ type: "action_failed", error: failure });
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
          accountPasswordRef.current = password;
          setEmail(session.email);
          await loadVaults();
        });
      },

      async signUp(userEmail, password) {
        await withStatus(async () => {
          const session = await api.register(userEmail, password);
          accountPasswordRef.current = password;
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
        accountPasswordRef.current = null;
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
          if (passwordsAreSame(accountPasswordRef.current ?? "", masterPassword)) {
            throw feedbackError("passwords_must_differ");
          }
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
        }, "vault_created");
      },

      async restoreFromShare(fileText, shareKey, masterPassword) {
        await withStatus(async () => {
          if (passwordsAreSame(accountPasswordRef.current ?? "", masterPassword)) {
            throw feedbackError("passwords_must_differ");
          }
          const entries = openSharePackage(fileText, shareKey);
          if (entries.length === 0) throw feedbackError("empty_share");
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
        }, "share_restored");
      },

      async unlockWithPassword(masterPassword) {
        if (!activeVaultId) throw feedbackError("no_vault_selected");
        await withStatus(async () => {
          setLockState("UNLOCKING");
          try {
            setUnlocked(await unlockWithMasterPassword(activeVaultId, masterPassword));
            writeActiveVaultId(activeVaultId);
            if (passwordsAreSame(accountPasswordRef.current ?? "", masterPassword)) {
              dispatchFeedback({ type: "notice", code: "password_reuse_warning" });
            }
          } catch (failure) {
            setLockState("LOCKED");
            throw failure;
          }
        });
      },

      passwordsCollide(vaultPassword) {
        return passwordsAreSame(accountPasswordRef.current ?? "", vaultPassword);
      },

      async unlockWithRecovery(key) {
        if (!activeVaultId) throw feedbackError("no_vault_selected");
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
        if (!activeVaultId) throw feedbackError("no_vault_selected");
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
        if (!current) throw feedbackError("vault_locked");
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
            throw feedbackError("no_other_vault");
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
        }, "entries_imported");
      },

      async saveEntries(entries) {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          setUnlocked(await commitEntries(current, entries));
        }, "entries_saved");
      },

      async enableBiometrics() {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
        if (!email) throw feedbackError("not_signed_in");
        return withStatus(async () => {
          const result = await enableDeviceUnlockForVault(current, email);
          setUnlocked(result.vault);
          setDeviceUnlockAvailable(true);
          setDevices(await api.listDevices(current.vaultId));
          return result.mechanism;
        }, "device_unlock_enabled");
      },

      async revoke(targetDeviceId) {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          setUnlocked(await revokeDevice(current, targetDeviceId));
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) setDeviceUnlockAvailable(false);
        }, "device_soft_revoked");
      },

      async hardRevoke(targetDeviceId, masterPassword, recoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
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
        }, "vault_key_rotated");
      },

      async replaceTrustedRecovery(oldRecoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText);
          setUnlocked(next.vault);
          setRecoveryKey(next.recoveryKey);
        }, "recovery_replaced");
      },

      async rotateCompromisedRecovery(masterPassword, previousRecoveryKeyText) {
        const current = vaultRef.current;
        if (!current) throw feedbackError("vault_locked");
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
        }, "recovery_compromised_rotated");
      },

      refreshDevices,

      dismissRecoveryKey() {
        setRecoveryKey(null);
      },

      clearMessages() {
        dispatchFeedback({ type: "clear" });
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
      error: feedback.error,
      notice: feedback.notice,
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
      feedback,
      recoveryKey,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
