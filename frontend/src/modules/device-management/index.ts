import { useCallback, useRef, useState } from "react";
import { api, type DeviceSummary } from "../../lib/api.ts";
import type { UnlockedVault } from "../../lib/vault-session.ts";
import type { VaultLiveness } from "../../lib/vault-liveness.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

import { createDeviceMutations } from "./device-mutations.ts";
import { createHardRevokeCoordinator, type RevokeProgress } from "./hard-revoke-coordinator.ts";

export type { RevokeProgress } from "./hard-revoke-coordinator.ts";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseDeviceManagementOptions {
  runWithStatus: RunWithStatus;
  showNotice(code: NoticeCode): void;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  currentVault(): UnlockedVault | null;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
}

export interface DeviceManagement {
  devices: DeviceSummary[];
  revokeProgress: RevokeProgress | null;
  reconcileHardRevoke(): Promise<void>;
  refreshDevices(): Promise<void>;
  clearDevices(): void;
  enableBiometrics(): Promise<DeviceUnlockMechanism>;
  revoke(targetDeviceId: string): Promise<void>;
  hardRevoke(
    targetDeviceId: string,
    masterPassword: string,
    recoveryKeyText?: string,
  ): Promise<void>;
}

export function useDeviceManagement(options: UseDeviceManagementOptions): DeviceManagement {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [revokeProgress, setRevokeProgress] = useState<RevokeProgress | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const coordinatorRef = useRef<ReturnType<typeof createHardRevokeCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createHardRevokeCoordinator(() => ({
      ...optionsRef.current, setDevices, progress: setRevokeProgress,
    }));
  }
  const coordinator = coordinatorRef.current;
  const mutationsRef = useRef<ReturnType<typeof createDeviceMutations> | null>(null);
  if (!mutationsRef.current) {
    mutationsRef.current = createDeviceMutations(() => ({
      currentVault: optionsRef.current.currentVault,
      captureVaultLiveness: optionsRef.current.captureVaultLiveness,
      replaceUnlockedVault: optionsRef.current.replaceUnlockedVault,
      setDeviceUnlockAvailable: optionsRef.current.setDeviceUnlockAvailable,
      setDevices,
    }));
  }
  const mutations = mutationsRef.current;
  const deviceGeneration = useRef(0);

  const refreshDevices = useCallback(async () => {
    const activeVaultId = options.getActiveVaultId();
    if (!activeVaultId) return;
    const ticket = deviceGeneration.current;
    const next = await api.listDevices(activeVaultId);
    if (ticket === deviceGeneration.current && optionsRef.current.getActiveVaultId() === activeVaultId) setDevices(next);
  }, [options]);

  const clearDevices = useCallback(() => {
    deviceGeneration.current++;
    coordinator.clear();
    setDevices([]);
  }, [coordinator]);

  const enableBiometrics = useCallback(async (): Promise<DeviceUnlockMechanism> => {
    const accountEmail = options.getAccountEmail();
    if (!accountEmail) throw feedbackError("not_signed_in");
    return options.runWithStatus(
      () => mutations.enableBiometrics(accountEmail),
      "device_unlock_enabled",
    );
  }, [options, mutations]);

  const revoke = useCallback(async (targetDeviceId: string) => {
    await options.runWithStatus(() => mutations.revoke(targetDeviceId), "device_soft_revoked");
  }, [options, mutations]);

  const hardRevoke = useCallback(async (
    targetDeviceId: string,
    masterPassword: string,
    recoveryKeyText?: string,
  ) => {
    await options.runWithStatus(() => coordinator.hardRevoke(targetDeviceId, masterPassword, recoveryKeyText));
  }, [options, coordinator]);

  return { devices, revokeProgress, reconcileHardRevoke: coordinator.reconcile, refreshDevices, clearDevices, enableBiometrics, revoke, hardRevoke };
}
