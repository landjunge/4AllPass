import { equalBytes } from "./encoding/bytes.ts";
import { decryptEntry } from "./entry.ts";
import { unwrapVaultKey } from "./envelope.ts";
import { IntegrityError } from "./errors.ts";
import { assertId, assertVersion } from "./validate.ts";
import type { EncryptedEntry, EnvelopeType, KeyEnvelope } from "./types.ts";

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
 *
 * It is the *content* half of snapshot verification and is complementary to
 * `verifySnapshotManifest` (manifest.ts), which authenticates the `revision`
 * and the exact set of records. Run the manifest check first where a manifest
 * exists — it needs no wrapping key beyond VK and it detects records that are
 * individually valid but do not belong to this snapshot. This pass then proves
 * that everything actually decrypts under one Vault Key, which is also the only
 * available defence for a snapshot published before the manifest existed.
 */

export interface DecryptedEntry {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  vaultKeyVersion: number;
  plaintext: Uint8Array;
}

/** An additional envelope the caller holds a wrapping key for and can cross-check. */
export interface CrossCheckEnvelope {
  envelope: KeyEnvelope;
  wrappingKey: Uint8Array;
  /** Required for device envelopes: the device this envelope must belong to. */
  deviceId?: string;
  /** Required for device envelopes: the Device-Key generation the caller holds. */
  deviceKeyVersion?: number;
}

export interface VerifySnapshotOptions {
  vaultId: string;
  /** The Vault Key the caller already obtained by unwrapping their own envelope. */
  vaultKey: Uint8Array;
  /** The Vault-Key generation of this snapshot. Every entry must carry it. */
  vaultKeyVersion: number;
  entries: readonly EncryptedEntry[];
  /**
   * Optional additional envelopes the caller can unwrap (e.g. a master
   * envelope alongside a device envelope). Each MUST unwrap to the same
   * Vault Key. Envelopes the caller cannot unwrap (other devices) are simply
   * not passed here — per §6 they are "ignored as not applicable to this
   * device", not treated as errors.
   */
  crossCheckEnvelopes?: readonly CrossCheckEnvelope[];
  /** Accept a `ci`-profile master envelope during cross-check (tests only). */
  allowTestProfile?: boolean;
}

function unwrapForCrossCheck(
  vaultId: string,
  vaultKeyVersion: number,
  entry: CrossCheckEnvelope,
  allowTestProfile: boolean,
): Uint8Array {
  const type: EnvelopeType = entry.envelope?.type;
  return unwrapVaultKey(entry.envelope, {
    wrappingKey: entry.wrappingKey,
    vaultId,
    expectType: type,
    expectVaultKeyVersion: vaultKeyVersion,
    ...(type === "device"
      ? {
          expectDeviceId: assertId("crossCheck.deviceId", entry.deviceId),
          expectDeviceKeyVersion: assertVersion(
            "crossCheck.deviceKeyVersion",
            entry.deviceKeyVersion,
          ),
        }
      : {}),
    ...(allowTestProfile ? { allowTestProfile: true } : {}),
  });
}

/**
 * Verify that every entry decrypts under `vaultKey` and that every
 * cross-check envelope unwraps to the same `vaultKey`. Returns the decrypted
 * entries on success. Throws `IntegrityError` (wrapping the first underlying
 * failure) if any entry or cross-check envelope is inconsistent.
 */
export function verifySnapshot(opts: VerifySnapshotOptions): DecryptedEntry[] {
  const { vaultId, vaultKey, vaultKeyVersion, entries, crossCheckEnvelopes = [] } = opts;
  const allowTestProfile = opts.allowTestProfile === true;

  for (const crossCheck of crossCheckEnvelopes) {
    const type = crossCheck.envelope?.type;
    let candidate: Uint8Array;
    try {
      candidate = unwrapForCrossCheck(vaultId, vaultKeyVersion, crossCheck, allowTestProfile);
    } catch (cause) {
      throw new IntegrityError(
        `snapshot envelope (type=${String(type)}) failed to unwrap during cross-check`,
        { cause },
      );
    }
    if (!equalBytes(candidate, vaultKey)) {
      throw new IntegrityError(
        `snapshot envelope (type=${String(type)}) unwraps to a different Vault Key (mixed snapshot)`,
      );
    }
  }

  const decrypted: DecryptedEntry[] = [];
  for (const entry of entries) {
    let plaintext: Uint8Array;
    try {
      plaintext = decryptEntry(entry, {
        vaultKey,
        vaultId,
        entryId: entry.id,
        vaultKeyVersion,
      });
    } catch (cause) {
      throw new IntegrityError(
        `snapshot entry ${String(entry?.id)} failed to decrypt under the Vault Key (mixed or tampered snapshot)`,
        { cause },
      );
    }
    decrypted.push({
      id: entry.id,
      schemaVersion: entry.schemaVersion,
      cryptoVersion: entry.cryptoVersion,
      vaultKeyVersion: entry.vaultKeyVersion,
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
  /** The Vault-Key generation of this snapshot. */
  vaultKeyVersion: number;
  /** Required when the caller's own envelope is a device envelope. */
  deviceId?: string;
  /** Required when the caller's own envelope is a device envelope. */
  deviceKeyVersion?: number;
  entries: readonly EncryptedEntry[];
  crossCheckEnvelopes?: readonly CrossCheckEnvelope[];
  allowTestProfile?: boolean;
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
  const vaultKey = unwrapForCrossCheck(
    opts.vaultId,
    opts.vaultKeyVersion,
    {
      envelope: opts.envelope,
      wrappingKey: opts.wrappingKey,
      ...(opts.deviceId === undefined ? {} : { deviceId: opts.deviceId }),
      ...(opts.deviceKeyVersion === undefined ? {} : { deviceKeyVersion: opts.deviceKeyVersion }),
    },
    opts.allowTestProfile === true,
  );
  const entries = verifySnapshot({
    vaultId: opts.vaultId,
    vaultKey,
    vaultKeyVersion: opts.vaultKeyVersion,
    entries: opts.entries,
    ...(opts.crossCheckEnvelopes ? { crossCheckEnvelopes: opts.crossCheckEnvelopes } : {}),
    ...(opts.allowTestProfile ? { allowTestProfile: true } : {}),
  });
  return { vaultKey, entries };
}
