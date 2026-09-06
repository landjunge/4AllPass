import { useCallback, useRef, useState } from "react";
import { api, type VaultSummary } from "../../lib/api.ts";
import { clearCopiedSecret } from "../../lib/clipboard.ts";
import { openSharePackage } from "../../lib/share.ts";
import { readActiveVaultId, writeActiveVaultId } from "../../lib/active-vault.ts";
import { mergeImportedLogins } from "../../lib/import.ts";
import { decryptVaultEntries } from "../../lib/pull-other-vault.ts";
import type { VaultEntry } from "../../lib/entries.ts";
import {
  commitEntries,
  createVault,
  hasDeviceUnlock,
  lock as lockVault,
  unlockWithDevice,
  unlockWithMasterPassword,
  unlockWithRecoveryKey,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import type { LocalStoreStatus } from "../startup/index.ts";
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
  unlockWithBiometrics(): Promise<DeviceUnlockMechanism>;
  lock(): void;
  pullLocalIntoOpenVault(masterPassword: string): Promise<void>;
  saveEntries(entries: VaultEntry[]): Promise<void>;
  dismissRecoveryKey(): void;
  currentVault(): UnlockedVault | null;
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

  const replaceUnlockedVault = useCallback((next: UnlockedVault | null) => {
    vaultRef.current = next;
    setVault(next);
    setLockState(next ? "UNLOCKED" : "LOCKED");
  }, []);

  const currentVault = useCallback(() => vaultRef.current, []);

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
    await options.runWithStatus(async () => {
      if (options.passwordsCollide(masterPassword)) throw feedbackError("passwords_must_differ");
      setLockState("UNLOCKING");
      try {
        const created = await createVault(masterPassword, profile);
        setActiveVaultId(created.vault.vaultId);
        writeActiveVaultId(created.vault.vaultId);
        replaceUnlockedVault(created.vault);
        setRecoveryKey(created.recoveryKey);
        await loadVaults();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    }, "vault_created");
  }, [loadVaults, options, replaceUnlockedVault]);

  const restoreFromShare = useCallback(async (fileText: string, shareKey: string, masterPassword: string) => {
    await options.runWithStatus(async () => {
      if (options.passwordsCollide(masterPassword)) throw feedbackError("passwords_must_differ");
      const entries = openSharePackage(fileText, shareKey);
      if (entries.length === 0) throw feedbackError("empty_share");
      setLockState("UNLOCKING");
      try {
        const created = await createVault(masterPassword, "mobile_safe");
        const next = await commitEntries(created.vault, entries);
        setActiveVaultId(next.vaultId);
        writeActiveVaultId(next.vaultId);
        replaceUnlockedVault(next);
        setRecoveryKey(created.recoveryKey);
        await loadVaults();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    }, "share_restored");
  }, [loadVaults, options, replaceUnlockedVault]);

  const unlockWithPassword = useCallback(async (masterPassword: string) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    await options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        replaceUnlockedVault(await unlockWithMasterPassword(activeVaultId, masterPassword));
        writeActiveVaultId(activeVaultId);
        if (options.passwordsCollide(masterPassword)) options.onPasswordReuseWarning();
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, options, replaceUnlockedVault]);

  const unlockWithRecovery = useCallback(async (key: string) => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    await options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        replaceUnlockedVault(await unlockWithRecoveryKey(activeVaultId, key));
        writeActiveVaultId(activeVaultId);
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, options, replaceUnlockedVault]);

  const unlockWithBiometrics = useCallback(async (): Promise<DeviceUnlockMechanism> => {
    if (!activeVaultId) throw feedbackError("no_vault_selected");
    return options.runWithStatus(async () => {
      setLockState("UNLOCKING");
      try {
        const unlocked = await unlockWithDevice(activeVaultId);
        replaceUnlockedVault(unlocked);
        writeActiveVaultId(activeVaultId);
        return unlocked.unlockedWith as DeviceUnlockMechanism;
      } catch (failure) {
        setLockState("LOCKED");
        throw failure;
      }
    });
  }, [activeVaultId, options, replaceUnlockedVault]);

  const pullLocalIntoOpenVault = useCallback(async (masterPassword: string) => {
    const current = vaultRef.current;
    if (!current) throw feedbackError("vault_locked");
    const keepId = current.vaultId;
    await options.runWithStatus(async () => {
      const status = await api.localStatus();
      const adopted = status.hasLocalVault ? await api.adoptLocalVault() : { vaultId: null as string | null, entries: 0 };
      const listed = await api.listVaults();
      const sourceId = adopted.vaultId ?? status.localVaultId ?? listed.find((row) => row.vaultId !== keepId)?.vaultId ?? null;
      if (!sourceId || sourceId === keepId) throw feedbackError("no_other_vault");
      const incoming = await decryptVaultEntries(sourceId, masterPassword);
      const merged = mergeImportedLogins(current.entries, incoming);
      writeActiveVaultId(keepId);
      setActiveVaultId(keepId);
      replaceUnlockedVault(await commitEntries(current, merged));
      options.updateLocalStore({ hasLocalVault: false, localEntries: 0, hasOtherAccounts: true, localVaultId: null });
    }, "entries_imported");
  }, [options, replaceUnlockedVault]);

  const saveEntries = useCallback(async (entries: VaultEntry[]) => {
    const current = vaultRef.current;
    if (!current) throw feedbackError("vault_locked");
    await options.runWithStatus(async () => {
      replaceUnlockedVault(await commitEntries(current, entries));
    }, "entries_saved");
  }, [options, replaceUnlockedVault]);

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
    unlockWithBiometrics,
    lock,
    pullLocalIntoOpenVault,
    saveEntries,
    dismissRecoveryKey,
    currentVault,
    replaceUnlockedVault,
    setDeviceUnlockAvailable,
    setRecoveryKey,
  };
}
