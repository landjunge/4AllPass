import { useCallback, useEffect, useRef, useState } from "react";
import { deviceId } from "../devices/index.ts";
import {
  lock as lockVault,
  replaceTrustedRecoveryKey,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "../../lib/vault-liveness.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import { createRecoveryMasterCoordinator, type RecoveryMasterOffer } from "./master-coordinator.ts";

export type { RecoveryMasterOffer } from "./master-coordinator.ts";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseRecoveryManagementOptions {
  runWithStatus: RunWithStatus;
  currentVault(): UnlockedVault | null;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  lock(): void;
  setRecoveryKey(recoveryKey: string | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
  observedVault: UnlockedVault | null;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  passwordsCollide(password: string): boolean;
}

export interface RecoveryManagement {
  masterOffer: RecoveryMasterOffer | null;
  beginMasterOffer(vault: UnlockedVault): void;
  clearMasterOffer(): void;
  completeMasterOffer(newMasterPassword: string, recoveryKeyText: string): Promise<void>;
  retryMasterAdoption(): Promise<void>;
  replaceTrustedRecovery(oldRecoveryKeyText: string): Promise<void>;
  rotateCompromisedRecovery(
    masterPassword: string,
    previousRecoveryKeyText?: string,
  ): Promise<void>;
}

export function useRecoveryManagement(options: UseRecoveryManagementOptions): RecoveryManagement {
  const [masterOffer, setMasterOffer] = useState<RecoveryMasterOffer | null>(null);
  const masterOfferRef = useRef<RecoveryMasterOffer | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const coordinatorRef = useRef<ReturnType<typeof createRecoveryMasterCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createRecoveryMasterCoordinator(() => ({
      ...optionsRef.current,
      publish: (offer) => {
        masterOfferRef.current = offer;
        setMasterOffer(offer);
      },
    }));
  }
  const coordinator = coordinatorRef.current;
  useEffect(
    () => coordinator.sync(),
    [coordinator, options.observedVault, options.getActiveVaultId],
  );
  const completeMasterOffer = useCallback(async (newMasterPassword: string, recoveryKeyText: string) => {
    await options.runWithStatus(() => coordinator.complete(newMasterPassword, recoveryKeyText));
  }, [options, coordinator]);
  const retryMasterAdoption = useCallback(async () => {
    await optionsRef.current.runWithStatus(() => coordinator.retryAdoption());
  }, [coordinator]);
  const clearMasterOffer = useCallback(() => {
    const abandoned = masterOfferRef.current?.pendingAdoption
      ? optionsRef.current.currentVault() : null;
    coordinator.clear();
    if (abandoned && optionsRef.current.currentVault() === abandoned) {
      optionsRef.current.lock();
    }
  }, [coordinator]);
  useEffect(() => () => clearMasterOffer(), [clearMasterOffer]);

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
    masterOffer: coordinator.isCurrent() ? masterOffer : null,
    beginMasterOffer: coordinator.begin,
    clearMasterOffer,
    completeMasterOffer,
    retryMasterAdoption,
    replaceTrustedRecovery,
    rotateCompromisedRecovery: rotateRecovery,
  };
}
