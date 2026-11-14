import { DIGEST_BYTES } from "./constants.ts";
import { bytesToHex } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError, RollbackError } from "./errors.ts";
import { assertBytes, assertId, assertRevision, assertVersion } from "./validate.ts";
import type { VerifiedManifest } from "./manifest.ts";
import type { VaultRevision } from "./types.ts";
import {
  assertSnapshotProtocolVersion,
  expectedSnapshotProtocolVersion,
  type SnapshotProtocolOptions,
} from "./snapshot-protocol.ts";

export type RevisionAction = "first_seen" | "same" | "advance" | "rotation";

export interface RevisionAccept {
  ok: true;
  action: RevisionAction;
}

export interface RevisionReject {
  ok: false;
  action: "rollback" | "downgrade" | "mismatch";
  error: RollbackError | IntegrityError;
}

export type RevisionDecision = RevisionAccept | RevisionReject;

function assertRevisionFields(state: VaultRevision, label: string, expected: 1 | 2): void {
  if (state === null || typeof state !== "object") {
    throw new ProtocolError(`${label} must be an object`);
  }
  assertId(`${label} vaultId`, state.vaultId);
  assertRevision(`${label} revision`, state.revision);
  assertVersion(`${label} vaultKeyVersion`, state.vaultKeyVersion);
  const protocolVersion = assertSnapshotProtocolVersion(state.cryptoProtocolVersion);
  if (protocolVersion > expected) {
    throw new ProtocolError(
      `${label} cryptoProtocolVersion ${protocolVersion} exceeds the caller expectation (${expected})`,
    );
  }
  if (protocolVersion === 2 || state.manifestDigest !== undefined) {
    assertBytes(`${label} manifestDigest`, state.manifestDigest, { exact: DIGEST_BYTES });
  }
}

function reject(
  action: RevisionReject["action"],
  error: RollbackError | IntegrityError,
): RevisionReject {
  return { ok: false, action, error };
}

/**
 * Compare a locally pinned revision to a snapshot the server just offered.
 *
 * AES-GCM authenticity does not imply freshness. A malicious server can
 * replay an older *valid* snapshot. The client must refuse any incoming
 * revision or vaultKeyVersion that goes backwards, and any protocol change.
 *
 * `revision` is only trustworthy once it has been verified cryptographically —
 * see `openManifest` and `revisionFromManifest`. Pinning a number the server
 * merely asserted lets a hostile server poison the pin (claim revision
 * 4 294 967 295 once and every honest snapshot afterwards looks like a
 * rollback), which is why the bounds in `assertRevisionFields` are enforced and
 * why the pin should be written from a verified manifest.
 */
export function evaluateRevision(
  lastSeen: VaultRevision | null,
  incoming: VaultRevision,
  options: SnapshotProtocolOptions = {},
): RevisionDecision {
  const expected = expectedSnapshotProtocolVersion(options);
  assertRevisionFields(incoming, "incoming", expected);
  if (incoming.cryptoProtocolVersion !== expected) {
    throw new ProtocolError("incoming cryptoProtocolVersion does not match caller expectation");
  }
  if (lastSeen === null) {
    return { ok: true, action: "first_seen" };
  }
  assertRevisionFields(lastSeen, "lastSeen", expected);
  if (incoming.vaultId !== lastSeen.vaultId) {
    return reject("mismatch", new IntegrityError("incoming vaultId does not match pinned vault"));
  }
  if (incoming.cryptoProtocolVersion < lastSeen.cryptoProtocolVersion) {
    return reject(
      "downgrade",
      new IntegrityError(
        `cryptoProtocolVersion downgrade: ${incoming.cryptoProtocolVersion} < ${lastSeen.cryptoProtocolVersion}`,
      ),
    );
  }
  if (incoming.cryptoProtocolVersion !== lastSeen.cryptoProtocolVersion) {
    return reject("mismatch", new IntegrityError("vault protocol cannot change without a migration"));
  }
  if (incoming.revision < lastSeen.revision) {
    return reject("rollback", new RollbackError(lastSeen.revision, incoming.revision));
  }
  if (incoming.vaultKeyVersion < lastSeen.vaultKeyVersion) {
    return reject(
      "downgrade",
      new IntegrityError(
        `vaultKeyVersion downgrade: ${incoming.vaultKeyVersion} < ${lastSeen.vaultKeyVersion}`,
      ),
    );
  }
  // Once a revision was pinned with a verified manifest, every later answer
  // must carry one — same revision, advance, and rotation. Omitting it on a
  // higher claimed revision used to look like a clean advance and let the
  // client pin unauthenticated server integers.
  if (lastSeen.manifestDigest !== undefined && incoming.manifestDigest === undefined) {
    return reject(
      "mismatch",
      new IntegrityError(
        `revision ${lastSeen.revision} was pinned with a verified manifest; incoming state has none`,
      ),
    );
  }
  if (incoming.revision === lastSeen.revision) {
    if (incoming.vaultKeyVersion !== lastSeen.vaultKeyVersion) {
      return reject("mismatch", new IntegrityError("same revision but different vaultKeyVersion"));
    }
    if (lastSeen.manifestDigest !== undefined && incoming.manifestDigest !== undefined) {
      if (bytesToHex(lastSeen.manifestDigest) !== bytesToHex(incoming.manifestDigest)) {
        return reject(
          "mismatch",
          new IntegrityError(
            `revision ${incoming.revision} was served with two different manifests (server equivocation)`,
          ),
        );
      }
    }
    return { ok: true, action: "same" };
  }
  if (incoming.vaultKeyVersion > lastSeen.vaultKeyVersion) {
    return { ok: true, action: "rotation" };
  }
  return { ok: true, action: "advance" };
}

export function assertFreshSnapshot(
  lastSeen: VaultRevision | null,
  incoming: VaultRevision,
  options: SnapshotProtocolOptions = {},
): RevisionAction {
  const decision = evaluateRevision(lastSeen, incoming, options);
  if (!decision.ok) throw decision.error;
  return decision.action;
}

/**
 * Build the pinnable revision state from a manifest that has already been
 * verified under the Vault Key. This is the only pin a client should store.
 *
 * It takes the whole `VerifiedManifest` — manifest plus the digest of the blob
 * that was actually authenticated — rather than the two separately. Passing them
 * separately made it possible to pin the digest of a blob that was never
 * verified, which would turn the equivocation check into noise: the honest
 * snapshot is then rejected as a fork, and a digest of the attacker's choosing is
 * blessed instead.
 */
export function revisionFromManifest(
  verified: VerifiedManifest,
  options: SnapshotProtocolOptions = {},
): VaultRevision {
  const expectation = { cryptoProtocolVersion: expectedSnapshotProtocolVersion(options) };
  const { manifest } = verified;
  const pin: VaultRevision = {
    vaultId: assertId("manifest.vaultId", manifest.vaultId),
    revision: assertRevision("manifest.revision", manifest.revision),
    vaultKeyVersion: assertVersion("manifest.vaultKeyVersion", manifest.vaultKeyVersion),
    cryptoProtocolVersion: assertSnapshotProtocolVersion(manifest.cryptoProtocolVersion),
    manifestDigest: assertBytes("manifest digest", verified.sealedDigest, { exact: DIGEST_BYTES }),
  };
  assertFreshSnapshot(null, pin, expectation);
  return pin;
}
