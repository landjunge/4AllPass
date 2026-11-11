/**
 * Device mutations that await while the vault is open.
 *
 * The lifecycle owns the lock epoch and hands the caller a liveness check.
 * Both operations must abort before commit/adoption if the vault was locked
 * or replaced while the network or the authenticator was pending.
 */
import { api, type DeviceSummary } from "../../lib/api.ts";
import {
  enableDeviceUnlockForVault,
  lock as lockVault,
  revokeDevice,
  type EnabledDeviceUnlock,
  type UnlockedVault,
} from "../../lib/vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "../../lib/vault-liveness.ts";
import { deviceId } from "../devices/index.ts";
import { feedbackError } from "../feedback/index.ts";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";

export interface DeviceMutationDependencies {
  enableDeviceUnlockForVault(
    vault: UnlockedVault,
    accountEmail: string,
    liveness: VaultLiveness,
  ): Promise<EnabledDeviceUnlock>;
  revokeDevice(
    vault: UnlockedVault,
    targetDeviceId: string,
    liveness: VaultLiveness,
  ): Promise<UnlockedVault>;
  listDevices(vaultId: string): Promise<DeviceSummary[]>;
  lock(vault: UnlockedVault): void;
}

const defaults: DeviceMutationDependencies = {
  enableDeviceUnlockForVault: (vault, accountEmail, liveness) =>
    enableDeviceUnlockForVault(vault, accountEmail, liveness),
  revokeDevice: (vault, targetDeviceId, liveness) =>
    revokeDevice(vault, targetDeviceId, liveness),
  listDevices: (vaultId) => api.listDevices(vaultId),
  lock: lockVault,
};

export interface DeviceMutationCallbacks {
  currentVault(): UnlockedVault | null;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(next: UnlockedVault): void;
  setDeviceUnlockAvailable(available: boolean): void;
  setDevices(devices: DeviceSummary[]): void;
}

export function createDeviceMutations(
  callbacks: () => DeviceMutationCallbacks,
  dependencies: DeviceMutationDependencies = defaults,
) {
  async function enableBiometrics(accountEmail: string): Promise<DeviceUnlockMechanism> {
    const current = callbacks().currentVault();
    if (!current) throw feedbackError("vault_locked");
    const liveness = callbacks().captureVaultLiveness(current);

    const result = await dependencies.enableDeviceUnlockForVault(current, accountEmail, liveness);
    if (!liveness.isLive()) {
      dependencies.lock(result.vault);
      throw new VaultLockedError();
    }
    callbacks().replaceUnlockedVault(result.vault);
    callbacks().setDeviceUnlockAvailable(true);
    const devices = await dependencies.listDevices(current.vaultId);
    if (liveness.isLive()) callbacks().setDevices(devices);
    return result.mechanism;
  }

  async function revoke(targetDeviceId: string): Promise<void> {
    const current = callbacks().currentVault();
    if (!current) throw feedbackError("vault_locked");
    const liveness = callbacks().captureVaultLiveness(current);

    const next = await dependencies.revokeDevice(current, targetDeviceId, liveness);
    if (!liveness.isLive()) {
      dependencies.lock(next);
      throw new VaultLockedError();
    }
    callbacks().replaceUnlockedVault(next);
    const devices = await dependencies.listDevices(current.vaultId);
    if (liveness.isLive()) callbacks().setDevices(devices);
    if (targetDeviceId === deviceId()) callbacks().setDeviceUnlockAvailable(false);
  }

  return { enableBiometrics, revoke };
}
