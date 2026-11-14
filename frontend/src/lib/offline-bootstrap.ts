/**
 * Metadata-only offline bootstrap, bound to one proven session: account email,
 * a one-way SHA-256 fingerprint of the bearer token (never the token itself),
 * the storage origin, and the allow-listed vault list last loaded online.
 * No tokens, keys, entries or snapshot bytes live here — the encrypted
 * snapshot cache and the revision pin remain the only offline unlock inputs.
 * XSS on this origin can read this metadata like any other local store; it is
 * not a second security boundary.
 */
import type { VaultSummary } from "./api.ts";

const KEY = "4allpass.offline-bootstrap";
const VERSION = 2;
const TOP_KEYS = ["version", "email", "sessionFingerprint", "storageOrigin", "vaults"];
const SUMMARY_KEYS = [
  "vaultId", "cryptoProtocolVersion", "activeRevision", "activeVaultKeyVersion", "createdAt",
];

export interface OfflineBootstrapBinding {
  /** SHA-256 hex of the current bearer token; one-way, not replayable. */
  sessionFingerprint: string;
  storageOrigin: string | null;
}

export interface OfflineBootstrap {
  version: 2;
  email: string;
  sessionFingerprint: string;
  storageOrigin: string | null;
  vaults: VaultSummary[];
}

export async function fingerprintSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Validates the allowlisted fields; extra wire fields (e.g. creationGrant) are ignored here. */
function isSummaryFields(value: unknown): value is VaultSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  // Protocol 1 is the only implemented unlock/commit path. The value is
  // projected verbatim; a v2 summary is refused, never downgraded to v1.
  return typeof row.vaultId === "string" && row.vaultId.length > 0
    && row.cryptoProtocolVersion === 1
    && (row.activeRevision === null || isPositiveInteger(row.activeRevision))
    && (row.activeVaultKeyVersion === null || isPositiveInteger(row.activeVaultKeyVersion))
    && typeof row.createdAt === "string" && row.createdAt.length > 0;
}

/** Exact allowlist for persisted records: unknown keys mean tampering. */
function isSummary(value: unknown): value is VaultSummary {
  if (!isSummaryFields(value)) return false;
  const keys = Object.keys(value);
  return keys.length === SUMMARY_KEYS.length && SUMMARY_KEYS.every((key) => keys.includes(key));
}

function project(row: VaultSummary): VaultSummary {
  return {
    vaultId: row.vaultId,
    cryptoProtocolVersion: row.cryptoProtocolVersion,
    activeRevision: row.activeRevision,
    activeVaultKeyVersion: row.activeVaultKeyVersion,
    createdAt: row.createdAt,
  };
}

function isBinding(value: unknown): value is OfflineBootstrapBinding {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.sessionFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(row.sessionFingerprint)
    && (row.storageOrigin === null
      || (typeof row.storageOrigin === "string" && row.storageOrigin.length > 0));
}

/** Best effort: invalid input or a storage failure clears the cache, never throws. */
export async function saveOfflineBootstrap(
  email: string,
  vaults: VaultSummary[],
  binding: OfflineBootstrapBinding,
): Promise<void> {
  try {
    if (typeof email !== "string" || email.length === 0 || !vaults.every(isSummaryFields) || !isBinding(binding)) {
      throw new Error("offline bootstrap metadata is invalid");
    }
    const record: OfflineBootstrap = {
      version: VERSION,
      email,
      sessionFingerprint: binding.sessionFingerprint,
      storageOrigin: binding.storageOrigin,
      vaults: vaults.map(project),
    };
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    clearOfflineBootstrap();
  }
}

/** Returns the cache only when it is bound to exactly this session and origin. */
export function loadOfflineBootstrap(binding: OfflineBootstrapBinding): OfflineBootstrap | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    if (!isBinding(binding)) throw new Error("offline bootstrap binding invalid");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (
      keys.length !== TOP_KEYS.length || !TOP_KEYS.every((key) => keys.includes(key))
      || parsed.version !== VERSION
      || typeof parsed.email !== "string" || !parsed.email
      || parsed.sessionFingerprint !== binding.sessionFingerprint
      || parsed.storageOrigin !== binding.storageOrigin
      || !Array.isArray(parsed.vaults) || !parsed.vaults.every(isSummary)
    ) {
      throw new Error("offline bootstrap metadata invalid or foreign");
    }
    return {
      version: VERSION,
      email: parsed.email,
      sessionFingerprint: binding.sessionFingerprint,
      storageOrigin: binding.storageOrigin,
      vaults: (parsed.vaults as VaultSummary[]).map(project),
    };
  } catch {
    clearOfflineBootstrap();
    return null;
  }
}

export function clearOfflineBootstrap(): void {
  try { localStorage.removeItem(KEY); } catch { /* fail closed */ }
}
