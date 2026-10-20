/** Historical reads never write a freshness pin or an offline cache. */
import {
  bytesToBase64,
  IntegrityError,
  sealedManifestDigest,
  verifySnapshot,
  verifySnapshotManifest,
  zeroize,
  type KeyEnvelope,
  type VaultSnapshot,
} from "@4allpass/crypto";
import { decodeEntryPlaintext, type VaultEntry } from "./entries.ts";

interface HistoricKeyContext {
  vaultId: string;
  vaultKeyVersion: number;
  vaultKey: Uint8Array;
}

/** Local selection metadata, never a server-issued authorization receipt. */
export interface HistoricSelection {
  readonly vaultId: string;
  readonly revision: number;
  readonly vaultKeyVersion: number;
  readonly manifestDigest: string | null;
}

export class HistoricRevisionUnreadable extends Error {
  readonly revision: number;

  constructor(revision: number) {
    super(`revision ${String(revision)} was sealed under an earlier vault key`);
    this.name = "HistoricRevisionUnreadable";
    this.revision = revision;
  }
}

export function assertHistoricSelection(
  snapshot: VaultSnapshot,
  selected: HistoricSelection,
  expectedVaultId: string,
): void {
  const digest = snapshot.sealedManifest
    ? bytesToBase64(sealedManifestDigest(snapshot.sealedManifest)) : null;
  if (selected.vaultId !== expectedVaultId || snapshot.vaultId !== expectedVaultId
    || snapshot.revision !== selected.revision || snapshot.vaultKeyVersion !== selected.vaultKeyVersion
    || digest !== selected.manifestDigest) {
    throw new IntegrityError("historic snapshot no longer matches the selected revision");
  }
}

/** Return the actual authenticated records, not a second read of the inputs. */
export function openHistoricSnapshot(
  snapshot: VaultSnapshot,
  vault: HistoricKeyContext,
): { entries: VaultEntry[]; envelopes: KeyEnvelope[]; manifestDigest: string | null } {
  if (snapshot.vaultId !== vault.vaultId) {
    throw new IntegrityError("historic snapshot belongs to a different vault");
  }
  if (snapshot.vaultKeyVersion !== vault.vaultKeyVersion) {
    throw new HistoricRevisionUnreadable(snapshot.revision);
  }
  const verified = snapshot.sealedManifest ? verifySnapshotManifest(
    snapshot.sealedManifest,
    { entries: snapshot.entries, envelopes: snapshot.envelopes },
    { vaultKey: vault.vaultKey, vaultId: snapshot.vaultId,
      revision: snapshot.revision, vaultKeyVersion: snapshot.vaultKeyVersion },
  ) : null;
  // Legacy history has no authenticated record-set commitment. Keep its
  // existing per-entry checks, without describing it as manifest-authenticated.
  const entries = verifySnapshot({
    vaultId: snapshot.vaultId,
    vaultKey: vault.vaultKey,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    entries: verified?.entries ?? snapshot.entries,
  }).map((entry) => {
    try {
      return decodeEntryPlaintext(entry.id, entry.plaintext);
    } finally {
      zeroize(entry.plaintext);
    }
  }).sort((a, b) => a.title.localeCompare(b.title));
  return {
    entries,
    envelopes: verified?.envelopes ?? snapshot.envelopes,
    manifestDigest: verified ? bytesToBase64(verified.sealedDigest) : null,
  };
}
