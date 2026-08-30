/**
 * Read another vault's plaintext without locking the one already open.
 * `lock(source)` zeroizes only that object. Clone first.
 */
import type { VaultEntry } from "./entries.ts";
import { lock, unlockWithMasterPassword } from "./vault-session.ts";

export function cloneEntries(entries: VaultEntry[]): VaultEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export async function decryptVaultEntries(
  vaultId: string,
  masterPassword: string,
): Promise<VaultEntry[]> {
  const source = await unlockWithMasterPassword(vaultId, masterPassword);
  try {
    return cloneEntries(source.entries);
  } finally {
    lock(source);
  }
}
