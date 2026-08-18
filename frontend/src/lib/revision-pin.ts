/**
 * The locally pinned `(vaultId, revision, vaultKeyVersion)` of vault-revision.md §3.
 *
 * AES-GCM proves a snapshot was not modified, not that it is the latest one.
 * The pin lives outside the server's control so a replayed older snapshot is
 * refused instead of silently unlocked.
 */
import { base64ToBytes, bytesToBase64, type VaultRevision } from "@4allpass/crypto";

const PIN_PREFIX = "4allpass.pin.";

export function loadPin(vaultId: string): VaultRevision | null {
  const raw = localStorage.getItem(PIN_PREFIX + vaultId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      vaultId?: unknown;
      revision?: unknown;
      vaultKeyVersion?: unknown;
      manifestDigest?: unknown;
    };
    if (
      parsed.vaultId === vaultId &&
      Number.isInteger(parsed.revision) &&
      Number.isInteger(parsed.vaultKeyVersion)
    ) {
      return {
        vaultId: parsed.vaultId,
        revision: parsed.revision as number,
        vaultKeyVersion: parsed.vaultKeyVersion as number,
        cryptoProtocolVersion: 1,
        ...(typeof parsed.manifestDigest === "string"
          ? { manifestDigest: base64ToBytes(parsed.manifestDigest) }
          : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePin(pin: VaultRevision): void {
  localStorage.setItem(
    PIN_PREFIX + pin.vaultId,
    JSON.stringify({
      ...pin,
      ...(pin.manifestDigest
        ? { manifestDigest: bytesToBase64(pin.manifestDigest) }
        : {}),
    }),
  );
}
