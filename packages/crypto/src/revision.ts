import { assertId, assertVersionCounter } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError, RollbackError } from "./errors.ts";
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
  try {
    assertId(`${label} vaultId`, state.vaultId);
    assertVersionCounter(`${label} revision`, state.revision);
    assertVersionCounter(`${label} vaultKeyVersion`, state.vaultKeyVersion);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(`${label} is invalid`);
  }
  if (state.cryptoProtocolVersion !== 1) {
    throw new ProtocolError(`${label} unsupported cryptoProtocolVersion`);
  }
}

/**
 * Compare a locally pinned revision to a snapshot the server just offered.
 *
 * AES-GCM authenticity does not imply freshness. A malicious server can
 * replay an older *valid* snapshot. The client must refuse any incoming
 * revision or vaultKeyVersion that goes backwards.
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
    return {
      ok: false,
      action: "mismatch",
      error: new IntegrityError("incoming vaultId does not match pinned vault"),
    };
  }
  if (incoming.revision < lastSeen.revision) {
    return {
      ok: false,
      action: "rollback",
      error: new RollbackError(lastSeen.revision, incoming.revision),
    };
  }
  if (incoming.vaultKeyVersion < lastSeen.vaultKeyVersion) {
    return {
      ok: false,
      action: "downgrade",
      error: new IntegrityError(
        `vaultKeyVersion downgrade: ${incoming.vaultKeyVersion} < ${lastSeen.vaultKeyVersion}`,
      ),
    };
  }
  if (incoming.revision === lastSeen.revision) {
    if (incoming.vaultKeyVersion !== lastSeen.vaultKeyVersion) {
      return {
        ok: false,
        action: "mismatch",
        error: new IntegrityError("same revision but different vaultKeyVersion"),
      };
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
