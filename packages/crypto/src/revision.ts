import { CRYPTO_PROTOCOL_VERSION, DIGEST_BYTES } from "./constants.ts";
import { sealedManifestDigest } from "./encoding/digest.ts";
import { bytesToHex } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError, RollbackError } from "./errors.ts";
import { assertBytes, assertId, assertRevision, assertVersion } from "./validate.ts";
import type { SealedManifest, SnapshotManifest, VaultRevision } from "./types.ts";

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
 * why the pin should be written from a verified manifest.
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
  if (incoming.revision === lastSeen.revision) {
    if (incoming.vaultKeyVersion !== lastSeen.vaultKeyVersion) {
      return reject("mismatch", new IntegrityError("same revision but different vaultKeyVersion"));
    }
    if (lastSeen.manifestDigest !== undefined) {
      // Once a revision has been pinned with a verified manifest, an answer for
      // that same revision must come with the same manifest — and must come with
      // one at all, otherwise the check could simply be dropped.
      if (incoming.manifestDigest === undefined) {
        return reject(
          "mismatch",
          new IntegrityError(
            `revision ${incoming.revision} was pinned with a verified manifest; incoming state has none`,
          ),
        );
      }
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
 * opened under the Vault Key. This is the only pin a client should store: it
 * carries the digest of the sealed manifest, which makes a later "same
 * revision, different content" answer detectable.
 */
export function revisionFromManifest(
  manifest: SnapshotManifest,
  sealed: SealedManifest,
): VaultRevision {
  return {
    vaultId: assertId("manifest.vaultId", manifest.vaultId),
    revision: assertRevision("manifest.revision", manifest.revision),
    vaultKeyVersion: assertVersion("manifest.vaultKeyVersion", manifest.vaultKeyVersion),
    cryptoProtocolVersion: assertVersion(
      "manifest.cryptoProtocolVersion",
      manifest.cryptoProtocolVersion,
    ),
    manifestDigest: sealedManifestDigest(sealed),
  };
}
