/**
 * Optional automatic retention for the Papierkorb (P0 #279). Per-vault, local
 * only — never synced, never part of the encrypted snapshot. `null` (the
 * default) means "no automatic purge"; the structure exists for whoever
 * wants a retention period, without forcing one on everybody else.
 */
const PREFIX = "4allpass.trash-retention-days.v1.";

export function trashRetentionStorageKey(vaultId: string): string {
  return `${PREFIX}${vaultId}`;
}

/** `null` = disabled (no automatic purge). Always a positive integer otherwise. */
export function getTrashRetentionDays(vaultId: string): number | null {
  try {
    const raw = localStorage.getItem(trashRetentionStorageKey(vaultId));
    if (raw == null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** `days <= 0` or non-finite clears the setting (disables automatic purge). */
export function setTrashRetentionDays(vaultId: string, days: number | null): void {
  try {
    if (days == null || !Number.isFinite(days) || days <= 0) {
      localStorage.removeItem(trashRetentionStorageKey(vaultId));
      return;
    }
    localStorage.setItem(trashRetentionStorageKey(vaultId), String(Math.floor(days)));
  } catch {
    // Private mode — the setting just will not persist across reloads.
  }
}
