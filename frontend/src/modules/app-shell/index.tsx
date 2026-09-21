/**
 * App state composition. Vault, device and recovery lifecycles live in modules.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { api, type DeviceSummary, type VaultSummary } from "../../lib/api.ts";
import { deviceId } from "../../lib/device-identity.ts";
import { listenDesktopLock } from "../desktop-adapter/index.ts";
import { useAccount, type AccountState } from "../account/index.ts";
import { useStartup, type LocalStoreStatus } from "../startup/index.ts";
import {
  feedbackReducer,
  initialFeedbackState,
  type ErrorFeedback,
  type NoticeCode,
  type NoticeFeedback,
} from "../feedback/index.ts";
import { useVaultLifecycle, type LockState } from "../vault-lifecycle/index.ts";
import { useDeviceManagement } from "../device-management/index.ts";
import { useRecoveryManagement } from "../recovery-management/index.ts";
import type { VaultEntry } from "../../lib/entries.ts";
import type { HeadRecovery, UnlockedVault } from "../../lib/vault-session.ts";
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
  findHeadRecovery(masterPassword: string): Promise<HeadRecovery | null>;
  restoreHeadRecovery(masterPassword: string, recovery: HeadRecovery): Promise<void>;
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

  // macOS says it is about to suspend -> zeroize the Vault Key. Browser builds
  // get no such event and the subscribe call resolves to a no-op there.
  // Not FileVault: if the machine suspends before the webview drains the event,
  // the lock lands on wake instead, and VK sat in RAM meanwhile.
  const lockOnDesktopSleep = vaultLifecycle.lock;
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listenDesktopLock(lockOnDesktopSleep).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [lockOnDesktopSleep]);

  const getActiveVaultId = useCallback(() => vaultLifecycle.activeVaultId, [vaultLifecycle.activeVaultId]);
  const getAccountEmail = useCallback(() => accountRef.current?.email ?? null, []);
  const deviceManagementOptions = useMemo(
    () => ({
      runWithStatus: withStatus,
      getActiveVaultId,
      getAccountEmail,
      currentVault: vaultLifecycle.currentVault,
      replaceUnlockedVault: vaultLifecycle.replaceUnlockedVault,
      setDeviceUnlockAvailable: vaultLifecycle.setDeviceUnlockAvailable,
    }),
    [
      getAccountEmail,
      getActiveVaultId,
      vaultLifecycle.currentVault,
      vaultLifecycle.replaceUnlockedVault,
      vaultLifecycle.setDeviceUnlockAvailable,
      withStatus,
    ],
  );
  const deviceManagement = useDeviceManagement(deviceManagementOptions);

  const recoveryManagementOptions = useMemo(
    () => ({
      runWithStatus: withStatus,
      currentVault: vaultLifecycle.currentVault,
      replaceUnlockedVault: vaultLifecycle.replaceUnlockedVault,
      setRecoveryKey: vaultLifecycle.setRecoveryKey,
      setDeviceUnlockAvailable: vaultLifecycle.setDeviceUnlockAvailable,
    }),
    [
      vaultLifecycle.currentVault,
      vaultLifecycle.replaceUnlockedVault,
      vaultLifecycle.setDeviceUnlockAvailable,
      vaultLifecycle.setRecoveryKey,
      withStatus,
    ],
  );
  const recoveryManagement = useRecoveryManagement(recoveryManagementOptions);

  const afterSignUp = useCallback(
    () => vaultLifecycle.clearVaultList(),
    [vaultLifecycle.clearVaultList],
  );
  const afterSignOut = useCallback(() => {
    vaultLifecycle.clearSignedOutState();
    deviceManagement.clearDevices();
  }, [deviceManagement.clearDevices, vaultLifecycle.clearSignedOutState]);

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
      async findHeadRecovery(masterPassword) {
        return vaultLifecycle.findHeadRecovery(masterPassword);
      },
      async restoreHeadRecovery(masterPassword, recovery) {
        await vaultLifecycle.restoreHeadRecovery(masterPassword, recovery);
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
        return deviceManagement.enableBiometrics();
      },
      async revoke(targetDeviceId) {
        await deviceManagement.revoke(targetDeviceId);
      },
      async hardRevoke(targetDeviceId, masterPassword, recoveryKeyText) {
        await deviceManagement.hardRevoke(targetDeviceId, masterPassword, recoveryKeyText);
      },
      async replaceTrustedRecovery(oldRecoveryKeyText) {
        await recoveryManagement.replaceTrustedRecovery(oldRecoveryKeyText);
      },
      async rotateCompromisedRecovery(masterPassword, previousRecoveryKeyText) {
        await recoveryManagement.rotateCompromisedRecovery(masterPassword, previousRecoveryKeyText);
      },
      refreshDevices: deviceManagement.refreshDevices,
      dismissRecoveryKey: vaultLifecycle.dismissRecoveryKey,
      clearMessages() {
        dispatchFeedback({ type: "clear" });
      },
    }),
    [account, deviceManagement, recoveryManagement, vaultLifecycle],
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
      devices: deviceManagement.devices,
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
      deviceManagement.devices,
      feedback,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
