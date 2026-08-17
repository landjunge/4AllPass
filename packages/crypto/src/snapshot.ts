import { equalBytes } from "./encoding/bytes.ts";
import { decryptEntry } from "./entry.ts";
import { unwrapVaultKey } from "./envelope.ts";
import { IntegrityError } from "./errors.ts";
import type { EncryptedEntry, KeyEnvelope } from "./types.ts";

/**
 * Snapshot integrity pass — docs/vault-revision.md §6 ("Client integrity
 * pass after unwrap").
 *
 * `evaluateRevision` (revision.ts) only checks that a snapshot's
 * `(vaultId, revision, vaultKeyVersion)` triple is *fresh*. It does not
 * check that the snapshot's contents are internally consistent. A malicious
 * server can still serve a "mixed" snapshot — e.g. `VK₂` envelopes stitched
 * onto `VK₁` entries — that passes the freshness check.
 *
 * This module closes that gap: after a wrapping key unwraps the caller's own
 * envelope to a Vault Key, every entry must decrypt under *that* Vault Key,
 * and any additional envelopes the caller can unwrap must yield the *same*
 * Vault Key. A single failure rejects the whole snapshot with an
 * `IntegrityError`, so a mixed `VK₁`/`VK₂` snapshot can never be applied.
 */

export interface DecryptedEntry {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  plaintext: Uint8Array;
}

/** An additional envelope the caller holds a wrapping key for and can cross-check. */
export interface CrossCheckEnvelope {
  envelope: KeyEnvelope;
  wrappingKey: Uint8Array;
}

export interface VerifySnapshotOptions {
  vaultId: string;
  /** The Vault Key the caller already obtained by unwrapping their own envelope. */
  vaultKey: Uint8Array;
  entries: readonly EncryptedEntry[];
  /**
   * Optional additional envelopes the caller can unwrap (e.g. a master
   * envelope alongside a device envelope). Each MUST unwrap to the same
   * Vault Key. Envelopes the caller cannot unwrap (other devices) are simply
   * not passed here — per §6 they are "ignored as not applicable to this
   * device", not treated as errors.
   */
  crossCheckEnvelopes?: readonly CrossCheckEnvelope[];
}

/**
 * Verify that every entry decrypts under `vaultKey` and that every
 * cross-check envelope unwraps to the same `vaultKey`. Returns the decrypted
 * entries on success. Throws `IntegrityError` (wrapping the first underlying
 * failure) if any entry or cross-check envelope is inconsistent.
 */
export function verifySnapshot(opts: VerifySnapshotOptions): DecryptedEntry[] {
  const { vaultId, vaultKey, entries, crossCheckEnvelopes = [] } = opts;

  for (const { envelope, wrappingKey } of crossCheckEnvelopes) {
    let candidate: Uint8Array;
    try {
      candidate = unwrapVaultKey(envelope, wrappingKey, vaultId);
    } catch (cause) {
      throw new IntegrityError(
        `snapshot envelope (type=${envelope.type}) failed to unwrap during cross-check`,
        { cause },
      );
    }
    if (!equalBytes(candidate, vaultKey)) {
      throw new IntegrityError(
        `snapshot envelope (type=${envelope.type}) unwraps to a different Vault Key (mixed snapshot)`,
      );
    }
  }

  const decrypted: DecryptedEntry[] = [];
  for (const entry of entries) {
    let plaintext: Uint8Array;
    try {
      plaintext = decryptEntry(entry, vaultKey, vaultId);
    } catch (cause) {
      throw new IntegrityError(
        `snapshot entry ${entry.id} failed to decrypt under the Vault Key (mixed or tampered snapshot)`,
        { cause },
      );
    }
    decrypted.push({
      id: entry.id,
      schemaVersion: entry.schemaVersion,
      cryptoVersion: entry.cryptoVersion,
      plaintext,
    });
  }

  return decrypted;
}

export interface UnlockSnapshotOptions {
  vaultId: string;
  /** The caller's own envelope (master / device / recovery). */
  envelope: KeyEnvelope;
  /** The wrapping key for `envelope` (Master Key, Device Key, or Recovery Key). */
  wrappingKey: Uint8Array;
  entries: readonly EncryptedEntry[];
  crossCheckEnvelopes?: readonly CrossCheckEnvelope[];
}

export interface UnlockedSnapshot {
  vaultKey: Uint8Array;
  entries: DecryptedEntry[];
}

/**
 * Unwrap the caller's own envelope to the Vault Key, then run the integrity
 * pass over the whole snapshot.
 *
 * A wrong wrapping key (e.g. wrong Master Password) surfaces as the usual
 * `AuthFailureError` from `unwrapVaultKey` — a normal, expected condition, so
 * it is deliberately *not* rewrapped as `IntegrityError`. `IntegrityError` is
 * reserved for a snapshot that is internally inconsistent (mixed/tampered).
 */
export function unlockSnapshot(opts: UnlockSnapshotOptions): UnlockedSnapshot {
  const vaultKey = unwrapVaultKey(opts.envelope, opts.wrappingKey, opts.vaultId);
  const entries = verifySnapshot({
    vaultId: opts.vaultId,
    vaultKey,
    entries: opts.entries,
    ...(opts.crossCheckEnvelopes ? { crossCheckEnvelopes: opts.crossCheckEnvelopes } : {}),
  });
  return { vaultKey, entries };
}
