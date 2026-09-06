import { useCallback } from "react";
import { deviceId } from "../devices/index.ts";
import {
  replaceTrustedRecoveryKey,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseRecoveryManagementOptions {
  runWithStatus: RunWithStatus;
  currentVault(): UnlockedVault | null;
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
    await options.runWithStatus(async () => {
      const next = await replaceTrustedRecoveryKey(current, oldRecoveryKeyText);
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
    await options.runWithStatus(async () => {
      const next = await rotateCompromisedRecovery(current, {
        masterPassword,
        ...(previousRecoveryKeyText ? { previousRecoveryKeyText } : {}),
      });
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
