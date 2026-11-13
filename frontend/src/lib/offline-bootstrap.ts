/**
 * Metadata-only offline bootstrap: account identity plus the vault list that
 * was last loaded online. No tokens, keys, entries or snapshot bytes live here —
 * the encrypted snapshot cache and the revision pin remain the only offline
 * unlock inputs. XSS on this origin can read this metadata like any other local
 * store; it is not a second security boundary.
 */
import type { VaultSummary } from "./api.ts";

const KEY = "4allpass.offline-bootstrap";
const VERSION = 1;

export interface OfflineBootstrap {
  version: 1;
  email: string;
  vaults: VaultSummary[];
}

function isSummary(value: unknown): value is VaultSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.vaultId === "string"
    && row.vaultId.length > 0
    && row.cryptoProtocolVersion === 1
    && (row.activeRevision === null || (typeof row.activeRevision === "number" && row.activeRevision >= 1))
    && (row.activeVaultKeyVersion === null
      || (typeof row.activeVaultKeyVersion === "number" && row.activeVaultKeyVersion >= 1))
    && typeof row.createdAt === "string";
}

export function saveOfflineBootstrap(email: string, vaults: VaultSummary[]): void {
  if (typeof email !== "string" || email.length === 0 || !vaults.every(isSummary)) {
    throw new Error("offline bootstrap metadata is invalid");
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, email, vaults }));
  } catch {
    // Best effort, like the snapshot cache: a storage failure must not break
    // an online session.
  }
}

export function loadOfflineBootstrap(): OfflineBootstrap | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineBootstrap>;
    if (parsed.version !== VERSION || typeof parsed.email !== "string" || !parsed.email) {
      throw new Error("offline bootstrap version/identity invalid");
    }
    if (!Array.isArray(parsed.vaults) || !parsed.vaults.every(isSummary)) {
      throw new Error("offline bootstrap vault list invalid");
    }
    return { version: VERSION, email: parsed.email, vaults: parsed.vaults };
  } catch {
    try { localStorage.removeItem(KEY); } catch { /* fail closed anyway */ }
    return null;
  }
}

export function clearOfflineBootstrap(): void {
  try { localStorage.removeItem(KEY); } catch { /* fail closed */ }
}
