/**
 * Client integrity pass over an accepted snapshot (vault-revision.md §6).
 *
 * Freshness (`assertFreshSnapshot`) says the snapshot is not a replay. This
 * pass says the snapshot is internally consistent: one Vault Key seals every
 * envelope this client can open and decrypts every entry. It is what stops a
 * server from mixing VK₁ entries with VK₂ envelopes after a half-applied
 * rotation.
 */
import { KEY_BYTES } from "./constants.ts";
import { decryptEntry } from "./entry.ts";
import { unwrapVaultKey } from "./envelope.ts";
import { assertLength, equalBytes } from "./encoding/bytes.ts";
import { AuthFailureError, IntegrityError } from "./errors.ts";
import { zeroize } from "./memory.ts";
import type { KeyEnvelope, VaultSnapshot } from "./types.ts";

export interface SnapshotIntegrityOptions {
  snapshot: VaultSnapshot;
  /** Vault Key already obtained from one envelope of this snapshot. */
  vaultKey: Uint8Array;
  /**
   * Other envelopes of the same snapshot this client can open, with their
   * wrapping key. Envelopes without a key are skipped: they belong to other
   * devices ("not applicable to this device").
   */
  crossChecks?: ReadonlyArray<{ envelope: KeyEnvelope; wrappingKey: Uint8Array }>;
}

export function verifySnapshotIntegrity(options: SnapshotIntegrityOptions): void {
  const { snapshot, vaultKey } = options;
  assertLength("vaultKey", vaultKey, KEY_BYTES);
  if (snapshot.cryptoProtocolVersion !== 1) {
    throw new IntegrityError(`unsupported snapshot cryptoProtocolVersion: ${snapshot.cryptoProtocolVersion}`);
  }
  if (snapshot.envelopes.length === 0) {
    throw new IntegrityError("snapshot has no envelopes: the vault would be unrecoverable");
  }

  for (const check of options.crossChecks ?? []) {
    if (!snapshot.envelopes.includes(check.envelope)) {
      throw new IntegrityError("cross-checked envelope is not part of this snapshot");
    }
    let other: Uint8Array | undefined;
    try {
      other = unwrapVaultKey(check.envelope, check.wrappingKey, snapshot.vaultId);
    } catch (cause) {
      throw new IntegrityError(
        `envelope ${check.envelope.type}${check.envelope.deviceId ? `/${check.envelope.deviceId}` : ""} did not unwrap: ${(cause as Error).message}`,
      );
    }
    const same = equalBytes(other, vaultKey);
    zeroize(other);
    if (!same) {
      throw new IntegrityError(
        `envelope ${check.envelope.type} unwraps to a different Vault Key: snapshot mixes key versions`,
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    if (seen.has(entry.id)) {
      throw new IntegrityError(`duplicate entry id in snapshot: ${entry.id}`);
    }
    seen.add(entry.id);
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = decryptEntry(entry, vaultKey, snapshot.vaultId);
    } catch (cause) {
      if (cause instanceof AuthFailureError) {
        throw new IntegrityError(`entry ${entry.id} does not decrypt under this Vault Key`);
      }
      throw cause;
    } finally {
      zeroize(plaintext);
    }
  }
}
