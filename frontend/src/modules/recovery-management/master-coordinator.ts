import { lock, setMasterPasswordAfterRecovery, type UnlockedVault } from "../../lib/vault-session.ts";
import { feedbackError } from "../feedback/index.ts";
import { savePin } from "../../lib/revision-pin.ts";

export interface RecoveryMasterOffer { vaultId: string; stage: "password" | "devices"; busy: boolean }
interface Callbacks {
  currentVault(): UnlockedVault | null;
  getActiveVaultId(): string | null;
  getAccountEmail(): string | null;
  passwordsCollide(password: string): boolean;
  replaceUnlockedVault(vault: UnlockedVault): void;
  publish(offer: RecoveryMasterOffer | null): void;
}

export function createRecoveryMasterCoordinator(
  callbacks: () => Callbacks,
  reset: (vault: UnlockedVault, options: { newMasterPassword: string; recoveryKeyText: string }) => Promise<UnlockedVault> = (vault, options) =>
    setMasterPasswordAfterRecovery(vault, { ...options, deferPin: true }),
) {
  let generation = 0;
  let context: UnlockedVault | null = null;
  let account: string | null = null;
  let stage: RecoveryMasterOffer["stage"] = "password";
  let running: object | null = null;
  function clear(): void {
    generation++;
    context = null;
    running = null;
    callbacks().publish(null);
  }
  function matches(vault: UnlockedVault): boolean {
    return callbacks().currentVault() === vault && callbacks().getActiveVaultId() === vault.vaultId
      && callbacks().getAccountEmail() === account;
  }
  function sync(): void {
    if (context && !matches(context)) clear();
  }
  function begin(vault: UnlockedVault): void {
    clear();
    account = callbacks().getAccountEmail();
    if (vault.unlockedWith !== "recovery_key" || !matches(vault)) return;
    context = vault;
    stage = "password";
    callbacks().publish({ vaultId: vault.vaultId, stage, busy: false });
  }
  async function complete(newMasterPassword: string, recoveryKeyText: string): Promise<void> {
    const current = context;
    if (!current || stage !== "password" || !matches(current) || running) {
      throw feedbackError("recovery_context_required");
    }
    // Same validation as creating a new vault password; existing unlock still
    // warns and remains usable. Never confuse this with account registration.
    if (callbacks().passwordsCollide(newMasterPassword)) throw feedbackError("passwords_must_differ");
    const ticket = generation;
    const token = {};
    running = token;
    callbacks().publish({ vaultId: current.vaultId, stage, busy: true });
    const valid = () => generation === ticket && context === current && matches(current);
    try {
      let next: UnlockedVault;
      try {
        next = await reset(current, { newMasterPassword, recoveryKeyText });
      } catch (error) {
        if (valid()) throw error;
        return;
      }
      if (!valid()) {
        lock(next);
        return;
      }
      // Adopt only here; a deferred pin from the commit is written now.
      if (next.acceptedPin) savePin(next.acceptedPin);
      // Commit adoption is complete before offering any separate device step.
      callbacks().replaceUnlockedVault(next);
      context = next;
      stage = "devices";
      callbacks().publish({ vaultId: next.vaultId, stage, busy: false });
    } finally {
      if (running === token) running = null;
      if (valid()) callbacks().publish({ vaultId: current.vaultId, stage: "password", busy: false });
    }
  }
  return { begin, complete, clear, sync, isCurrent: () => !!context && matches(context) };
}
