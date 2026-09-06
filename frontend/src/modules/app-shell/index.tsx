/**
 * App state composition. The vault lock lifecycle lives in vault-lifecycle.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type DeviceSummary, type VaultSummary } from "../../lib/api.ts";
import { deviceId } from "../../lib/device-identity.ts";
import { useAccount, type AccountState } from "../account/index.ts";
import { useStartup, type LocalStoreStatus } from "../startup/index.ts";
import {
  feedbackError,
  feedbackReducer,
  initialFeedbackState,
  type ErrorFeedback,
  type NoticeCode,
  type NoticeFeedback,
} from "../feedback/index.ts";
import {
  useVaultLifecycle,
  type LockState,
} from "../vault-lifecycle/index.ts";
import type { VaultEntry } from "../../lib/entries.ts";
import {
  enableDeviceUnlockForVault,
  hardRevokeDevice,
  replaceTrustedRecoveryKey,
  revokeDevice,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import type { Argon2idProfileName } from "@4allpass/crypto";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

export type { LockState } from "../vault-lifecycle/index.ts";

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
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [feedback, dispatchFeedback] = useReducer(feedbackReducer, initialFeedbackState);
  const accountRef = useRef<AccountState | null>(null);
  const updateLocalStoreRef = useRef<(status: LocalStoreStatus) => void>(() => undefined);

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

  const passwordsCollide = useCallback(
    (vaultPassword: string) => accountRef.current?.passwordsCollide(vaultPassword) ?? false,
    [],
  );
  const onPasswordReuseWarning = useCallback(() => {
    dispatchFeedback({ type: "notice", code: "password_reuse_warning" });
  }, []);
  const updateLocalStore = useCallback((status: LocalStoreStatus) => {
    updateLocalStoreRef.current(status);
  }, []);

  const vaultLifecycleOptions = useMemo(
    () => ({ runWithStatus: withStatus, passwordsCollide, onPasswordReuseWarning, updateLocalStore }),
    [onPasswordReuseWarning, passwordsCollide, updateLocalStore, withStatus],
  );
  const vaultLifecycle = useVaultLifecycle(vaultLifecycleOptions);

  const afterSignUp = useCallback(() => vaultLifecycle.clearVaultList(), [vaultLifecycle]);
  const afterSignOut = useCallback(() => {
    vaultLifecycle.clearSignedOutState();
    setDevices([]);
  }, [vaultLifecycle]);

  const account = useAccount({
    gateway: api,
    runWithStatus: withStatus,
    afterSignIn: vaultLifecycle.loadVaults,
    afterSignUp,
    beforeSignOut: vaultLifecycle.lock,
    afterSignOut,
  });
  accountRef.current = account;

  const restoreAccountSession = account.restoreSession;
  const startup = useStartup({ restoreSession: restoreAccountSession, loadVaults: vaultLifecycle.loadVaults });
  updateLocalStoreRef.current = startup.updateLocalStore;

  const refreshDevices = useCallback(async () => {
    if (!vaultLifecycle.activeVaultId) return;
    setDevices(await api.listDevices(vaultLifecycle.activeVaultId));
  }, [vaultLifecycle.activeVaultId]);

  const actions: AppActions = useMemo(
    () => ({
      async signIn(userEmail, password) {
        await account.signIn(userEmail, password);
      },
      async signUp(userEmail, password) {
        await account.signUp(userEmail, password);
      },
      async openThisMac() {
        await account.openThisMac();
      },
      async signOut() {
        await account.signOut();
      },
      async selectVault(vaultId) {
        await vaultLifecycle.selectVault(vaultId);
      },
      async createNewVault(masterPassword, profile = "mobile_safe") {
        await vaultLifecycle.createNewVault(masterPassword, profile);
      },
      async restoreFromShare(fileText, shareKey, masterPassword) {
        await vaultLifecycle.restoreFromShare(fileText, shareKey, masterPassword);
      },
      async unlockWithPassword(masterPassword) {
        await vaultLifecycle.unlockWithPassword(masterPassword);
      },
      passwordsCollide(vaultPassword) {
        return account.passwordsCollide(vaultPassword);
      },
      async unlockWithRecovery(key) {
        await vaultLifecycle.unlockWithRecovery(key);
      },
      async unlockWithBiometrics() {
        return vaultLifecycle.unlockWithBiometrics();
      },
      lock: vaultLifecycle.lock,
      async pullLocalIntoOpenVault(masterPassword) {
        await vaultLifecycle.pullLocalIntoOpenVault(masterPassword);
      },
      async saveEntries(entries) {
        await vaultLifecycle.saveEntries(entries);
      },
      async enableBiometrics() {
        const current = vaultLifecycle.currentVault();
        if (!current) throw feedbackError("vault_locked");
        const accountEmail = account.email;
        if (!accountEmail) throw feedbackError("not_signed_in");
        return withStatus(async () => {
          const result = await enableDeviceUnlockForVault(current, accountEmail);
          vaultLifecycle.replaceUnlockedVault(result.vault);
          vaultLifecycle.setDeviceUnlockAvailable(true);
          setDevices(await api.listDevices(current.vaultId));
          return result.mechanism;
        }, "device_unlock_enabled");
      },
      async revoke(targetDeviceId) {
        const current = vaultLifecycle.currentVault();
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          vaultLifecycle.replaceUnlockedVault(await revokeDevice(current, targetDeviceId));
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) vaultLifecycle.setDeviceUnlockAvailable(false);
        }, "device_soft_revoked");
      },
      async hardRevoke(targetDeviceId, masterPassword, recoveryKeyText) {
        const current = vaultLifecycle.currentVault();
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          const next = await hardRevokeDevice(current, {
            targetDeviceId,
            masterPassword,
            ...(recoveryKeyText ? { recoveryKeyText } : {}),
          });
          setDevices(await api.listDevices(current.vaultId));
          if (targetDeviceId === deviceId()) {
            vaultLifecycle.replaceUnlockedVault(null);
            vaultLifecycle.setDeviceUnlockAvailable(false);
          } else {
            vaultLifecycle.replaceUnlockedVault(next);
            if (!next.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
              vaultLifecycle.setDeviceUnlockAvailable(false);
            }
          }
        }, "vault_key_rotated");
      },
      async replaceTrustedRecovery(oldRecoveryKeyText) {
        const current = vaultLifecycle.currentVault();
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText);
          vaultLifecycle.replaceUnlockedVault(next.vault);
          vaultLifecycle.setRecoveryKey(next.recoveryKey);
        }, "recovery_replaced");
      },
      async rotateCompromisedRecovery(masterPassword, previousRecoveryKeyText) {
        const current = vaultLifecycle.currentVault();
        if (!current) throw feedbackError("vault_locked");
        await withStatus(async () => {
          const next = await rotateCompromisedRecovery(current, {
            masterPassword,
            ...(previousRecoveryKeyText ? { previousRecoveryKeyText } : {}),
          });
          vaultLifecycle.replaceUnlockedVault(next.vault);
          vaultLifecycle.setRecoveryKey(next.recoveryKey);
          if (!next.vault.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
            vaultLifecycle.setDeviceUnlockAvailable(false);
          }
        }, "recovery_compromised_rotated");
      },
      refreshDevices,
      dismissRecoveryKey: vaultLifecycle.dismissRecoveryKey,
      clearMessages() {
        dispatchFeedback({ type: "clear" });
      },
    }),
    [account, refreshDevices, vaultLifecycle, withStatus],
  );

  const value = useMemo(
    () => ({
      ready: startup.ready,
      email: account.email,
      localMode: startup.localMode,
      localStore: startup.localStore,
      vaults: vaultLifecycle.vaults,
      activeVaultId: vaultLifecycle.activeVaultId,
      lockState: vaultLifecycle.lockState,
      vault: vaultLifecycle.vault,
      devices,
      deviceUnlockAvailable: vaultLifecycle.deviceUnlockAvailable,
      thisDeviceId: deviceId(),
      error: feedback.error,
      notice: feedback.notice,
      recoveryKey: vaultLifecycle.recoveryKey,
      ...actions,
    }),
    [
      startup.ready,
      startup.localMode,
      startup.localStore,
      account.email,
      vaultLifecycle,
      devices,
      feedback,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
