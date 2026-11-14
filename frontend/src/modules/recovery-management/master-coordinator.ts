import { lock, setMasterPasswordAfterRecovery, type UnlockedVault } from "../../lib/vault-session.ts";
import { feedbackError } from "../feedback/index.ts";
import { persistDeferredPin } from "../../lib/vault-session.ts";
import type { VaultLiveness } from "../../lib/vault-liveness.ts";

export interface RecoveryMasterOffer {
  vaultId: string;
  stage: "password" | "devices";
  busy: boolean;
  pendingAdoption?: boolean;
}
interface Callbacks {
  currentVault(): UnlockedVault | null;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  passwordsCollide(password: string): boolean;
  captureVaultLiveness(vault: UnlockedVault): VaultLiveness;
  replaceUnlockedVault(vault: UnlockedVault): void;
  publish(offer: RecoveryMasterOffer | null): void;
}
interface PendingAdoption {
  next: UnlockedVault;
  ticket: number;
  valid(): boolean;
}

export function createRecoveryMasterCoordinator(
  callbacks: () => Callbacks,
  reset: (vault: UnlockedVault, options: { newMasterPassword: string; recoveryKeyText: string; liveness: VaultLiveness }) => Promise<UnlockedVault> = (vault, options) =>
    setMasterPasswordAfterRecovery(vault, { ...options, deferPin: true }),
) {
  let generation = 0;
  let context: UnlockedVault | null = null;
  let liveness: VaultLiveness | undefined;
  let account: string | null = null;
  let stage: RecoveryMasterOffer["stage"] = "password";
  let running: object | null = null;
  let pending: PendingAdoption | null = null;
  // A confirmed reset consumes its origin even if adoption is later cancelled.
  const consumed = new WeakSet<UnlockedVault>();
  function discard(record: PendingAdoption): void {
    if (pending === record) pending = null;
    if (callbacks().currentVault() !== record.next) lock(record.next);
  }
  function clear(): void {
    generation++;
    if (pending) discard(pending);
    context = null;
    liveness = undefined;
    running = null;
    callbacks().publish(null);
  }
  function matches(vault: UnlockedVault): boolean {
    return callbacks().currentVault() === vault && callbacks().getActiveVaultId() === vault.vaultId
      && callbacks().getAccountEmail() === account;
  }
  function currentIsLive(): boolean {
    return !!context && !!liveness && matches(context) && liveness.isLive();
  }
  function publish(): void {
    if (context) callbacks().publish({ vaultId: context.vaultId, stage, busy: !!running,
      ...(pending ? { pendingAdoption: true } : {}),
    });
  }
  function sync(): void {
    if (context && !currentIsLive()) clear();
  }
  function begin(vault: UnlockedVault): void {
    if (context === vault && currentIsLive()) {
      publish();
      return;
    }
    clear();
    account = callbacks().getAccountEmail();
    if (consumed.has(vault) || vault.vaultKey.length === 0 || vault.vaultKey.every((b) => b === 0)
      || vault.unlockedWith !== "recovery_key" || !matches(vault)) return;
    context = vault;
    liveness = callbacks().captureVaultLiveness(vault);
    stage = "password";
    if (!currentIsLive()) { clear(); return; }
    publish();
  }
  function adopt(record: PendingAdoption): void {
    if (pending !== record || !record.valid()) { discard(record); return; }
    persistDeferredPin(record.next.vaultId, record.next.revision);
    // Storage can synchronously clear/switch the context. Never adopt afterward.
    if (pending !== record || !record.valid()) { discard(record); return; }
    callbacks().replaceUnlockedVault(record.next);
    if (pending !== record || generation !== record.ticket) { discard(record); return; }
    if (callbacks().currentVault() !== record.next
      || callbacks().getActiveVaultId() !== record.next.vaultId
      || callbacks().getAccountEmail() !== account) { clear(); return; }
    pending = null; // Ownership transfers to the app, not to clear().
    context = record.next;
    liveness = callbacks().captureVaultLiveness(record.next);
    stage = "devices";
    if (!currentIsLive()) { clear(); return; }
    callbacks().publish({ vaultId: record.next.vaultId, stage, busy: false });
  }
  async function complete(newMasterPassword: string, recoveryKeyText: string): Promise<void> {
    sync();
    const current = context;
    const live = liveness;
    if (!current || !live || stage !== "password" || !currentIsLive() || running || pending || consumed.has(current)) {
      throw feedbackError("recovery_context_required");
    }
    if (callbacks().passwordsCollide(newMasterPassword)) throw feedbackError("passwords_must_differ");
    const ticket = generation;
    const token = {};
    running = token;
    const valid = () => generation === ticket && context === current && matches(current) && live.isLive();
    try {
      publish();
      if (!valid()) return;
      let next: UnlockedVault;
      try {
        next = await reset(current, { newMasterPassword, recoveryKeyText, liveness: live });
      } catch (error) {
        if (valid()) throw error;
        return;
      }
      consumed.add(current);
      const record: PendingAdoption = { next, ticket, valid };
      if (!valid()) { discard(record); return; }
      pending = record;
      // Make the committed boundary visible before any storage callback.
      publish();
      adopt(record);
    } finally {
      if (running === token) {
        running = null;
        if (valid()) publish();
        else if (generation === ticket && context === current) clear();
      }
    }
  }
  async function retryAdoption(): Promise<void> {
    sync();
    const record = pending;
    if (!record || running || !record.valid()) throw feedbackError("recovery_context_required");
    const token = {};
    running = token;
    try {
      publish();
      adopt(record);
    } finally {
      if (running === token) {
        running = null;
        if (pending === record && record.valid()) publish();
        else if (generation === record.ticket && pending === record) clear();
      }
    }
  }
  return { begin, complete, retryAdoption, clear, sync, isCurrent: currentIsLive };
}
