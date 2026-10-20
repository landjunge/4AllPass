import { useCallback, useRef, useState } from "react";
import { api, type DeviceSummary } from "../../lib/api.ts";
import { deviceId } from "../devices/index.ts";
import {
  enableDeviceUnlockForVault,
  revokeDevice,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

import { createHardRevokeCoordinator, type RevokeProgress } from "./hard-revoke-coordinator.ts";

export type { RevokeProgress } from "./hard-revoke-coordinator.ts";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseDeviceManagementOptions {
  runWithStatus: RunWithStatus;
  showNotice(code: NoticeCode): void;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  currentVault(): UnlockedVault | null;
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
    const current = options.currentVault();
    if (!current) throw feedbackError("vault_locked");
    const accountEmail = options.getAccountEmail();
    if (!accountEmail) throw feedbackError("not_signed_in");
    return options.runWithStatus(async () => {
      const result = await enableDeviceUnlockForVault(current, accountEmail);
      options.replaceUnlockedVault(result.vault);
      options.setDeviceUnlockAvailable(true);
      setDevices(await api.listDevices(current.vaultId));
      return result.mechanism;
    }, "device_unlock_enabled");
  }, [options]);

  const revoke = useCallback(async (targetDeviceId: string) => {
    const current = options.currentVault();
    if (!current) throw feedbackError("vault_locked");
    await options.runWithStatus(async () => {
      options.replaceUnlockedVault(await revokeDevice(current, targetDeviceId));
      setDevices(await api.listDevices(current.vaultId));
      if (targetDeviceId === deviceId()) options.setDeviceUnlockAvailable(false);
    }, "device_soft_revoked");
  }, [options]);

  const hardRevoke = useCallback(async (
    targetDeviceId: string,
    masterPassword: string,
    recoveryKeyText?: string,
  ) => {
    await options.runWithStatus(() => coordinator.hardRevoke(targetDeviceId, masterPassword, recoveryKeyText));
  }, [options, coordinator]);

  return { devices, revokeProgress, reconcileHardRevoke: coordinator.reconcile, refreshDevices, clearDevices, enableBiometrics, revoke, hardRevoke };
}
