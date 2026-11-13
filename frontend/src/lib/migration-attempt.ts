/**
 * Durable metadata for one explicit legacy-manifest migration attempt.
 *
 * No keys, plaintext or server truth: only the vault identity, base revision,
 * prepared sealed-manifest digest, operation id and a local state. The record is
 * written before the effect so a reload cannot turn an unknown outcome into a
 * fresh POST.
 */
export type MigrationAttemptState = "prepared" | "unknown" | "resolved" | "rejected";

export interface MigrationAttempt {
  schema: 1;
  vaultId: string;
  vaultKeyVersion: number;
  baseRevision: number;
  operationID: string;
  preparedManifestDigest: string;
  state: MigrationAttemptState;
  createdAt: string;
}

const PREFIX = "4allpass.legacy-migration.";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function key(vaultId: string): string {
  return PREFIX + vaultId;
}

export function newOperationId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return `mig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function loadMigrationAttempt(vaultId: string): MigrationAttempt | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key(vaultId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MigrationAttempt>;
    if (
      value.schema !== 1 ||
      value.vaultId !== vaultId ||
      typeof value.vaultKeyVersion !== "number" ||
      typeof value.baseRevision !== "number" ||
      typeof value.operationID !== "string" ||
      typeof value.preparedManifestDigest !== "string" ||
      !["prepared", "unknown", "resolved", "rejected"].includes(value.state ?? "") ||
      typeof value.createdAt !== "string"
    ) {
      return null;
    }
    return value as MigrationAttempt;
  } catch {
    return null;
  }
}

/** Throws when the record cannot be written; the caller must not POST then. */
export function saveMigrationAttempt(attempt: MigrationAttempt): void {
  const store = storage();
  if (!store) throw new Error("legacy migration metadata storage unavailable");
  store.setItem(key(attempt.vaultId), JSON.stringify(attempt));
}

export function removeMigrationAttempt(vaultId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key(vaultId));
  } catch {
    // best effort cleanup only
  }
}

export function migrationAttemptBlocks(
  attempt: MigrationAttempt | null,
  vault: { vaultId: string; revision: number; vaultKeyVersion: number },
): boolean {
  return Boolean(
    attempt &&
      (attempt.state === "prepared" || attempt.state === "unknown") &&
      attempt.vaultId === vault.vaultId &&
      attempt.baseRevision === vault.revision &&
      attempt.vaultKeyVersion === vault.vaultKeyVersion,
  );
}
