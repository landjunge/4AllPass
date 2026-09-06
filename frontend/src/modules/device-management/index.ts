import { useCallback, useState } from "react";
import { api, type DeviceSummary } from "../../lib/api.ts";
import { deviceId } from "../devices/index.ts";
import {
  enableDeviceUnlockForVault,
  hardRevokeDevice,
  revokeDevice,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

type RunWithStatus = <T>(action: () => Promise<T>, success?: NoticeCode) => Promise<T>;

export interface UseDeviceManagementOptions {
  runWithStatus: RunWithStatus;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  currentVault(): UnlockedVault | null;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
}

export interface DeviceManagement {
  devices: DeviceSummary[];
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

  const refreshDevices = useCallback(async () => {
    const activeVaultId = options.getActiveVaultId();
    if (!activeVaultId) return;
    setDevices(await api.listDevices(activeVaultId));
  }, [options]);

  const clearDevices = useCallback(() => setDevices([]), []);

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
    const current = options.currentVault();
    if (!current) throw feedbackError("vault_locked");
    await options.runWithStatus(async () => {
      const next = await hardRevokeDevice(current, {
        targetDeviceId,
        masterPassword,
        ...(recoveryKeyText ? { recoveryKeyText } : {}),
      });
      setDevices(await api.listDevices(current.vaultId));
      if (targetDeviceId === deviceId()) {
        options.replaceUnlockedVault(null);
        options.setDeviceUnlockAvailable(false);
      } else {
        options.replaceUnlockedVault(next);
        if (!next.envelopes.some((env) => env.type === "device" && env.deviceId === deviceId())) {
          options.setDeviceUnlockAvailable(false);
        }
      }
    }, "vault_key_rotated");
  }, [options]);

  return { devices, refreshDevices, clearDevices, enableBiometrics, revoke, hardRevoke };
}
