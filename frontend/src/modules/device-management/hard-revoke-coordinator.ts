import { api, type DeviceSummary } from "../../lib/api.ts";
import { deviceId } from "../devices/index.ts";
import { hardRevokeDevice, lock, type UnlockedVault } from "../../lib/vault-session.ts";
import type { CommittedHardRevoke } from "../../lib/hard-revoke-result.ts";
import { feedbackError, type NoticeCode } from "../feedback/index.ts";

export type RevokePhase = "revoke_pending" | "refresh_pending";
export interface RevokeProgress { phase: RevokePhase; busy: boolean }

interface Callbacks {
  currentVault(): UnlockedVault | null;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  replaceUnlockedVault(next: UnlockedVault | null): void;
  setDeviceUnlockAvailable(available: boolean): void;
  setDevices(devices: DeviceSummary[]): void;
  showNotice(code: NoticeCode): void;
  progress(progress: RevokeProgress | null): void;
}

// These are the productive dependencies; injection exercises the same caller
// ordering without substituting a second state machine in tests.
const defaults = { commit: hardRevokeDevice, revoke: api.revokeDevice, list: api.listDevices };

export function createHardRevokeCoordinator(
  callbacks: () => Callbacks,
  dependencies = defaults,
) {
  let generation = 0;
  let rotation: object | null = null;
  let pending: { vaultId: string; targetDeviceId: string; phase: RevokePhase } | null = null;
  let reconciling = false;

  function clear(): void {
    generation++;
    rotation = null;
    pending = null;
    reconciling = false;
    callbacks().progress(null);
  }

  async function reconcile(): Promise<void> {
    if (!pending || reconciling) return;
    const task = pending;
    const ticket = generation;
    const account = callbacks().getAccountEmail();
    const valid = () => generation === ticket && pending === task && callbacks().getAccountEmail() === account;
    reconciling = true;
    callbacks().progress({ phase: task.phase, busy: true });
    try {
      if (task.phase === "revoke_pending") {
        await dependencies.revoke(task.vaultId, task.targetDeviceId);
        if (!valid()) return;
        // DELETE is acknowledged. A failed GET must never repeat the rotation
        // or misreport metadata revocation as still uncommitted.
        task.phase = "refresh_pending";
        callbacks().progress({ phase: task.phase, busy: true });
      }
      const devices = await dependencies.list(task.vaultId);
      if (!valid()) return;
      if (callbacks().getActiveVaultId() === task.vaultId) callbacks().setDevices(devices);
      pending = null;
      callbacks().progress(null);
      callbacks().showNotice("vault_key_rotated");
    } catch {
      // Fixed, persistent DE/EN partial-completion text is rendered from phase.
      // Never expose server bodies or turn an acknowledged CAS into a retry.
    } finally {
      if (generation === ticket && callbacks().getAccountEmail() === account) {
        reconciling = false;
        if (pending === task) callbacks().progress({ phase: task.phase, busy: false });
      }
    }
  }

  async function hardRevoke(targetDeviceId: string, masterPassword: string, recoveryKeyText?: string): Promise<void> {
    if (rotation || pending) throw feedbackError("hard_revoke_pending");
    const current = callbacks().currentVault();
    if (!current) throw feedbackError("vault_locked");
    const token = {};
    rotation = token;
    const ticket = generation;
    const account = callbacks().getAccountEmail();
    const valid = () => generation === ticket && callbacks().getAccountEmail() === account;
    try {
      let committed: CommittedHardRevoke;
      try {
        committed = await dependencies.commit(current, {
          targetDeviceId, masterPassword, ...(recoveryKeyText ? { recoveryKeyText } : {}),
        });
      } catch (error) {
        if (valid()) throw error;
        return;
      }
      if (!valid()) {
        lock(committed.vault);
        return;
      }
      // Adopt (or self-lock) BEFORE the first fallible metadata request.
      // A lock/vault switch while CAS was in flight must never reopen the UI.
      if (callbacks().currentVault() === current) {
        callbacks().replaceUnlockedVault(committed.selfRevoked ? null : committed.vault);
      } else {
        lock(committed.vault);
      }
      // A user may already have pressed Lock while the CAS was in flight.
      // Keep that context locked and remove its now-absent device-unlock offer.
      if (callbacks().getActiveVaultId() === current.vaultId && (committed.selfRevoked || !committed.vault.envelopes.some(
        (env) => env.type === "device" && env.deviceId === deviceId(),
      ))) callbacks().setDeviceUnlockAvailable(false);
      pending = { vaultId: current.vaultId, targetDeviceId: committed.targetDeviceId, phase: "revoke_pending" };
      void reconcile();
    } finally {
      if (rotation === token) rotation = null;
    }
  }

  return { hardRevoke, reconcile, clear };
}
