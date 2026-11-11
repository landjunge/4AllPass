import { useCallback } from "react";
import { deviceId } from "../devices/index.ts";
import {
  lock as lockVault,
  replaceTrustedRecoveryKey,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "../../lib/vault-liveness.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseRecoveryManagementOptions {
  runWithStatus: RunWithStatus;
  currentVault(): UnlockedVault | null;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  setRecoveryKey(recoveryKey: string | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
}

export interface RecoveryManagement {
  replaceTrustedRecovery(oldRecoveryKeyText: string): Promise<void>;
  rotateCompromisedRecovery(
    masterPassword: string,
    previousRecoveryKeyText?: string,
  ): Promise<void>;
}

export function useRecoveryManagement(options: UseRecoveryManagementOptions): RecoveryManagement {
  const replaceTrustedRecovery = useCallback(async (oldRecoveryKeyText: string) => {
    const current = options.currentVault();
    if (!current) throw feedbackError("vault_locked");
    const liveness = options.captureVaultLiveness(current);
    await options.runWithStatus(async () => {
      const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText, liveness);
      if (!liveness.isLive()) {
        lockVault(next.vault);
        throw new VaultLockedError();
      }
      options.replaceUnlockedVault(next.vault);
      options.setRecoveryKey(next.recoveryKey);
    }, "recovery_replaced");
  }, [options]);

  const rotateRecovery = useCallback(async (
    masterPassword: string,
    previousRecoveryKeyText?: string,
  ) => {
    const current = options.currentVault();
    if (!current) throw feedbackError("vault_locked");
    const liveness = options.captureVaultLiveness(current);
    await options.runWithStatus(async () => {
      const next = await rotateCompromisedRecovery(current, {
        masterPassword,
        liveness,
        ...(previousRecoveryKeyText ? { previousRecoveryKeyText } : {}),
      });
      if (!liveness.isLive()) {
        lockVault(next.vault);
        throw new VaultLockedError();
      }
      options.replaceUnlockedVault(next.vault);
      options.setRecoveryKey(next.recoveryKey);
      if (!next.vault.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
        options.setDeviceUnlockAvailable(false);
      }
    }, "recovery_compromised_rotated");
  }, [options]);

  return {
    replaceTrustedRecovery,
    rotateCompromisedRecovery: rotateRecovery,
  };
}
