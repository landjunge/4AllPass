import { CRYPTO_PROTOCOL_VERSION, DIGEST_BYTES } from "./constants.ts";
import { bytesToHex } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError, RollbackError } from "./errors.ts";
import { assertBytes, assertId, assertRevision, assertVersion } from "./validate.ts";
import type { VerifiedManifest } from "./manifest.ts";
import type { VaultRevision } from "./types.ts";

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

function assertRevisionFields(state: VaultRevision, label: string): void {
  if (state === null || typeof state !== "object") {
    throw new ProtocolError(`${label} must be an object`);
  }
  assertId(`${label} vaultId`, state.vaultId);
  assertRevision(`${label} revision`, state.revision);
  assertVersion(`${label} vaultKeyVersion`, state.vaultKeyVersion);
  const protocolVersion = assertVersion(`${label} cryptoProtocolVersion`, state.cryptoProtocolVersion);
  if (protocolVersion > CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(
      `${label} cryptoProtocolVersion ${protocolVersion} is newer than this client supports (${CRYPTO_PROTOCOL_VERSION})`,
    );
  }
  if (state.manifestDigest !== undefined) {
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
 * revision, vaultKeyVersion or protocol version that goes backwards.
 *
 * `revision` is only trustworthy once it has been verified cryptographically —
 * see `openManifest` and `revisionFromManifest`. Pinning a number the server
 * merely asserted lets a hostile server poison the pin (claim revision
 * 4 294 967 295 once and every honest snapshot afterwards looks like a
 * rollback), which is why the bounds in `assertRevisionFields` are enforced and
 * why the pin must be written from a verified manifest — never from the
 * metadata the server sent alongside it.
 *
 * A pin that carries a `manifestDigest` is a statement that this vault
 * publishes manifests. From then on every answer must carry one, at any
 * revision. Accepting a manifest-free answer for a later revision would hand
 * the server rollback, truncation and revoked-device replay back for the price
 * of incrementing a number.
 */
export function evaluateRevision(
  lastSeen: VaultRevision | null,
  incoming: VaultRevision,
): RevisionDecision {
  assertRevisionFields(incoming, "incoming");
  if (lastSeen === null) {
    return { ok: true, action: "first_seen" };
  }
  assertRevisionFields(lastSeen, "lastSeen");
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
  // Once *any* revision of this vault has been pinned from a verified manifest,
  // the vault publishes manifests. An answer without one is not a legacy
  // snapshot, it is the manifest check being dropped — and dropping it takes
  // rollback detection, set-membership (revoked-device replay, truncation) and
  // pin integrity with it. Restricting this to `incoming.revision ===
  // lastSeen.revision` left the whole check optional: bump the number and the
  // server is trusted again.
  if (lastSeen.manifestDigest !== undefined && incoming.manifestDigest === undefined) {
    return reject(
      "mismatch",
      new IntegrityError(
        `vault ${incoming.vaultId} was pinned with a verified manifest at revision ${lastSeen.revision}; incoming revision ${incoming.revision} has none`,
      ),
    );
  }
  if (incoming.revision === lastSeen.revision) {
    if (incoming.vaultKeyVersion !== lastSeen.vaultKeyVersion) {
      return reject("mismatch", new IntegrityError("same revision but different vaultKeyVersion"));
    }
    if (lastSeen.manifestDigest !== undefined && incoming.manifestDigest !== undefined) {
      // The same revision must come back with the same manifest.
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
): RevisionAction {
  const decision = evaluateRevision(lastSeen, incoming);
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
export function revisionFromManifest(verified: VerifiedManifest): VaultRevision {
  const { manifest } = verified;
  return {
    vaultId: assertId("manifest.vaultId", manifest.vaultId),
    revision: assertRevision("manifest.revision", manifest.revision),
    vaultKeyVersion: assertVersion("manifest.vaultKeyVersion", manifest.vaultKeyVersion),
    cryptoProtocolVersion: assertVersion(
      "manifest.cryptoProtocolVersion",
      manifest.cryptoProtocolVersion,
    ),
    manifestDigest: assertBytes("manifest digest", verified.sealedDigest, { exact: DIGEST_BYTES }),
  };
}
