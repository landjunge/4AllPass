/**
 * Pull the local source vault into the vault that is already open.
 *
 * Every step after `lock()` must lose. The imported plaintext is the most
 * sensitive input here: a lock while any of the awaits is pending must abort
 * before `commitEntries` and drop the imported entries instead of sealing them
 * under a zeroized Vault Key.
 */
import { api, type VaultSummary } from "../../lib/api.ts";
import { wipeVaultEntry, type VaultEntry } from "../../lib/entries.ts";
import { mergeImportedLogins } from "../../lib/import.ts";
import { decryptVaultEntries } from "../../lib/pull-other-vault.ts";
import { commitEntries, lock as lockVault, type UnlockedVault } from "../../lib/vault-session.ts";
import { VaultLockedError, type VaultLiveness } from "../../lib/vault-liveness.ts";
import { feedbackError } from "../feedback/index.ts";
import type { LocalStoreStatus } from "../startup/index.ts";

export interface AdoptedLocalVault {
  vaultId: string | null;
  entries: number;
}

export interface PullLocalDependencies {
  localStatus(): Promise<LocalStoreStatus>;
  adoptLocalVault(): Promise<AdoptedLocalVault>;
  listVaults(): Promise<VaultSummary[]>;
  decryptEntries(vaultId: string, masterPassword: string): Promise<VaultEntry[]>;
  commitEntries(
    vault: UnlockedVault,
    entries: VaultEntry[],
    liveness: VaultLiveness,
  ): Promise<UnlockedVault>;
  lock(vault: UnlockedVault): void;
}

const defaults: PullLocalDependencies = {
  localStatus: () => api.localStatus(),
  adoptLocalVault: () => api.adoptLocalVault(),
  listVaults: () => api.listVaults(),
  decryptEntries: (vaultId, masterPassword) => decryptVaultEntries(vaultId, masterPassword),
  commitEntries: (vault, entries, liveness) => commitEntries(vault, entries, liveness),
  lock: lockVault,
};

export interface PullLocalInput {
  current: UnlockedVault;
  masterPassword: string;
  liveness: VaultLiveness;
}

function wipeEntries(entries: readonly VaultEntry[]): void {
  for (const entry of entries) wipeVaultEntry(entry);
}

export async function pullLocalEntries(
  input: PullLocalInput,
  dependencies: PullLocalDependencies = defaults,
): Promise<UnlockedVault> {
  const keepId = input.current.vaultId;
  const status = await dependencies.localStatus();
  input.liveness.assertLive();
  const adopted = status.hasLocalVault
    ? await dependencies.adoptLocalVault()
    : { vaultId: null as string | null, entries: 0 };
  input.liveness.assertLive();
  const listed = await dependencies.listVaults();
  input.liveness.assertLive();
  const sourceId =
    adopted.vaultId ??
    status.localVaultId ??
    listed.find((row) => row.vaultId !== keepId)?.vaultId ??
    null;
  if (!sourceId || sourceId === keepId) throw feedbackError("no_other_vault");

  const incoming = await dependencies.decryptEntries(sourceId, input.masterPassword);
  if (!input.liveness.isLive()) {
    wipeEntries(incoming);
    throw new VaultLockedError();
  }
  const merged = mergeImportedLogins(input.current.entries, incoming);
  try {
    const next = await dependencies.commitEntries(input.current, merged, input.liveness);
    if (!input.liveness.isLive()) {
      dependencies.lock(next);
      throw new VaultLockedError();
    }
    return next;
  } finally {
    // The committed vault contains fresh copies; drop the imported plaintext
    // references whether the commit won, lost, or failed.
    wipeEntries(incoming);
  }
}
