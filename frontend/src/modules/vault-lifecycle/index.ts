import { useCallback, useRef, useState } from "react";
import { api, type VaultSummary } from "../../lib/api.ts";
import { clearCopiedSecret } from "../../lib/clipboard.ts";
import { openSharePackage } from "../../lib/share.ts";
import { readActiveVaultId, writeActiveVaultId } from "../../lib/active-vault.ts";
import type { VaultEntry } from "../../lib/entries.ts";
import {
  commitEntries,
  createVault,
  findRecoverableRevision,
  restoreRecoveredRevision,
  hasDeviceUnlock,
  lock as lockVault,
  unlockWithDevice,
  unlockWithMasterPassword,
  unlockWithRecoveryKey,
  type HeadRecovery,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { captureVaultLiveness, VaultLockedError, type VaultLiveness } from "../../lib/vault-liveness.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import type { LocalStoreStatus } from "../startup/index.ts";
import { pullLocalEntries } from "./pull-local.ts";
import type { Argon2idProfileName } from "@4allpass/crypto";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

export type LockState = "LOCKED" | "UNLOCKING" | "UNLOCKED" | "LOCKING";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseVaultLifecycleOptions {
  runWithStatus: RunWithStatus;
  passwordsCollide(vaultPassword: string): boolean;
  onPasswordReuseWarning(): void;
  updateLocalStore(status: LocalStoreStatus): void;
}

export interface VaultLifecycleState {
  vaults: VaultSummary[];
  activeVaultId: string | null;
  lockState: LockState;
  vault: UnlockedVault | null;
  deviceUnlockAvailable: boolean;
  recoveryKey: string | null;
}

export interface VaultLifecycleActions {
  loadVaults(): Promise<VaultSummary[]>;
  clearVaultList(): void;
  clearSignedOutState(): void;
  selectVault(vaultId: string): Promise<void>;
  createNewVault(masterPassword: string, profile?: Argon2idProfileName): Promise<void>;
  restoreFromShare(fileText: string, shareKey: string, masterPassword: string): Promise<void>;
  unlockWithPassword(masterPassword: string): Promise<void>;
  unlockWithRecovery(recoveryKey: string): Promise<void>;
  findHeadRecovery(masterPassword: string): Promise<HeadRecovery | null>;
  restoreHeadRecovery(masterPassword: string, recovery: HeadRecovery): Promise<void>;
  unlockWithBiometrics(): Promise<DeviceUnlockMechanism>;
  lock(): void;
  pullLocalIntoOpenVault(masterPassword: string): Promise<void>;
  saveEntries(entries: VaultEntry[]): Promise<void>;
  dismissRecoveryKey(): void;
  currentVault(): UnlockedVault | null;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
  setRecoveryKey(recoveryKey: string | null): void;
}

export type VaultLifecycle = VaultLifecycleState & VaultLifecycleActions;

export function useVaultLifecycle(options: UseVaultLifecycleOptions): VaultLifecycle {
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>("LOCKED");
  const [vault, setVault] = useState<UnlockedVault | null>(null);
  const [deviceUnlockAvailable, setDeviceUnlockAvailable] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const vaultRef = useRef<UnlockedVault | null>(null);
  const lockEpoch = useRef(0);

  const replaceUnlockedVault = useCallback((next: UnlockedVault | null) => {
    vaultRef.current = next;
    setVault(next);
    setLockState(next ? "UNLOCKED" : "LOCKED");
  }, []);

  const currentVault = useCallback(() => vaultRef.current, []);

  const lock = useCallback(() => {
    // Bump even without an open vault so a pending unlock cannot win later.
    lockEpoch.current += 1;
    const current = vaultRef.current;
    if (!current) {
      setLockState("LOCKED");
      return;
    }
    setLockState("LOCKING");
    lockVault(current);
    vaultRef.current = null;
    setVault(null);
    setLockState("LOCKED");
    void clearCopiedSecret().catch(() => undefined);
  }, []);

  const captureLiveness = useCallback((current: UnlockedVault) =>
    captureVaultLiveness(current, () => lockEpoch.current, () => vaultRef.current), []);

  /** Adopt only when no lock happened since `epoch` was captured. */
  const adoptUnlocked = useCallback((epoch: number, next: UnlockedVault) => {
    if (lockEpoch.current !== epoch) {
      lockVault(next);
      throw new VaultLockedError();
    }
    replaceUnlockedVault(next);
  }, [replaceUnlockedVault]);

  /** Adopt only while the exact captured vault is still the live one. */
  const adoptIfLive = useCallback((liveness: VaultLiveness, next: UnlockedVault) => {
    if (!liveness.isLive()) {
      lockVault(next);
      throw new VaultLockedError();
    }
    replaceUnlockedVault(next);
  }, [replaceUnlockedVault]);

  const loadVaults = useCallback(async (): Promise<VaultSummary[]> => {
    const list = await api.listVaults();
    setVaults(list);
    let next: string | null = null;
    setActiveVaultId((current) => {
      const remembered = current ?? readActiveVaultId();
      next = remembered && list.some((row) => row.vaultId === remembered) ? remembered : (list[0]?.vaultId ?? null);
      writeActiveVaultId(next);
      return next;
    });
    if (next) setDeviceUnlockAvailable(await hasDeviceUnlock(next));
    return list;
  }, []);

  const clearVaultList = useCallback(() => setVaults([]), []);
  const clearSignedOutState = useCallback(() => {
    setVaults([]);
    setActiveVaultId(null);
  }, []);

  const selectVault = useCallback(async (vaultId: string) => {
    lock();
    setActiveVaultId(vaultId);
    writeActiveVaultId(vaultId);
    setDeviceUnlockAvailable(await hasDeviceUnlock(vaultId));
  }, [lock]);

  const createNewVault = useCallback(async (masterPassword: string, profile: Argon2idProfileName = "mobile_safe") => {
    const epoch = lockEpoch.current;
    await options.runWithStatus(async () => {
      if (options.passwordsCollide(masterPassword)) throw feedbackError("passwords_must_differ");
      setLockState("UNLOCKING");
      try {
        const created = await createVault(masterPassword, profile);
        adoptUnlocked(epoch, created.vault);
        setActiveVaultId(created.vault.vaultId);
        writeActiveVaultId(created.vault.vaultId);
        setRecoveryKey(created.recoveryKey);
        await loadVaults();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    }, "vault_created");
  }, [adoptUnlocked, loadVaults, options]);

  const restoreFromShare = useCallback(async (fileText: string, shareKey: string, masterPassword: string) => {
    const epoch = lockEpoch.current;
    await options.runWithStatus(async () => {
      if (options.passwordsCollide(masterPassword)) throw feedbackError("passwords_must_differ");
      const entries = openSharePackage(fileText, shareKey);
      if (entries.length === 0) throw feedbackError("empty_share");
      setLockState("UNLOCKING");
      try {
        const created = await createVault(masterPassword, "mobile_safe");
        if (lockEpoch.current !== epoch) {
          lockVault(created.vault);
          throw new VaultLockedError();
        }
        const next = await commitEntries(created.vault, entries);
        adoptUnlocked(epoch, next);
        setActiveVaultId(next.vaultId);
        writeActiveVaultId(next.vaultId);
        setRecoveryKey(created.recoveryKey);
        await loadVaults();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    }, "share_restored");
  }, [adoptUnlocked, loadVaults, options]);

  const unlockWithPassword = useCallback(async (masterPassword: string) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    const epoch = lockEpoch.current;
    await options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        const unlocked = await unlockWithMasterPassword(activeVaultId, masterPassword);
        adoptUnlocked(epoch, unlocked);
        writeActiveVaultId(activeVaultId);
        if (options.passwordsCollide(masterPassword)) options.onPasswordReuseWarning();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, adoptUnlocked, options]);

  /**
   * ADR-015 §2. Only reachable after an unlock failed on integrity, and only
   * on an explicit click: a poisoned head must never quietly become "here is
   * some older content instead".
   */
  const findHeadRecovery = useCallback(async (masterPassword: string) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    return findRecoverableRevision(activeVaultId, masterPassword);
  }, [activeVaultId]);

  const restoreHeadRecovery = useCallback(async (
    masterPassword: string,
    recovery: HeadRecovery,
  ) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    const epoch = lockEpoch.current;
    await options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        const recovered = await restoreRecoveredRevision(activeVaultId, masterPassword, recovery);
        adoptUnlocked(epoch, recovered);
        writeActiveVaultId(activeVaultId);
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, adoptUnlocked, options]);

  const unlockWithRecovery = useCallback(async (key: string) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    const epoch = lockEpoch.current;
    await options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        const unlocked = await unlockWithRecoveryKey(activeVaultId, key);
        adoptUnlocked(epoch, unlocked);
        writeActiveVaultId(activeVaultId);
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, adoptUnlocked, options]);

  const unlockWithBiometrics = useCallback(async (): Promise<DeviceUnlockMechanism> => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    const epoch = lockEpoch.current;
    return options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        const unlocked = await unlockWithDevice(activeVaultId);
        adoptUnlocked(epoch, unlocked);
        writeActiveVaultId(activeVaultId);
        return unlocked.unlockedWith as DeviceUnlockMechanism;
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, adoptUnlocked, options]);

  const pullLocalIntoOpenVault = useCallback(async (masterPassword: string) => {
    const current = vaultRef.current;
    if (!current) throw feedbackError("vault_locked");
    const keepId = current.vaultId;
    const liveness = captureLiveness(current);
    await options.runWithStatus(async () => {
      const next = await pullLocalEntries({ current, masterPassword, liveness });
      adoptIfLive(liveness, next);
      writeActiveVaultId(keepId);
      setActiveVaultId(keepId);
      options.updateLocalStore({ hasLocalVault: false, localEntries: 0, hasOtherAccounts: true, localVaultId: null });
    }, "entries_imported");
  }, [adoptIfLive, captureLiveness, options]);

  const saveEntries = useCallback(async (entries: VaultEntry[]) => {
    const current = vaultRef.current;
    if (!current) throw feedbackError("vault_locked");
    const liveness = captureLiveness(current);
    await options.runWithStatus(async () => {
      const next = await commitEntries(current, entries, liveness);
      adoptIfLive(liveness, next);
    }, "entries_saved");
  }, [adoptIfLive, captureLiveness, options]);

  const dismissRecoveryKey = useCallback(() => setRecoveryKey(null), []);

  return {
    vaults,
    activeVaultId,
    lockState,
    vault,
    deviceUnlockAvailable,
    recoveryKey,
    loadVaults,
    clearVaultList,
    clearSignedOutState,
    selectVault,
    createNewVault,
    restoreFromShare,
    unlockWithPassword,
    unlockWithRecovery,
    findHeadRecovery,
    restoreHeadRecovery,
    unlockWithBiometrics,
    lock,
    pullLocalIntoOpenVault,
    saveEntries,
    dismissRecoveryKey,
    currentVault,
    captureVaultLiveness: captureLiveness,
    replaceUnlockedVault,
    setDeviceUnlockAvailable,
    setRecoveryKey,
  };
}
