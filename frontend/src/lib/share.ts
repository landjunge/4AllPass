/**
 * Selective item share for protocol v1: a portable snapshot, not a server ACL.
 *
 * v1 has no public-key wrapping, so this cannot wrap a Vault Key to someone
 * else's Device Key. The package is a new random VK, one recovery envelope,
 * only the chosen entries, and a sealed manifest. The file is never uploaded.
 * A copy already given cannot be remotely revoked.
 */
import {
  buildManifest,
  bytesToHex,
  decodeVaultSnapshot,
  deriveRecoveryWrappingKey,
  encodeVaultSnapshot,
  encryptEntry,
  formatRecoveryKey,
  generateRecoveryKey,
  generateVaultKey,
  parseRecoveryKey,
  randomBytes,
  sealManifest,
  unwrapVaultKey,
  verifySnapshot,
  verifySnapshotManifest,
  wrapVaultKey,
  zeroize,
  type WireVaultSnapshot,
} from "@4allpass/crypto";
import {
  decodeEntryPlaintext,
  encodeEntryPlaintext,
  ENTRY_SCHEMA_VERSION,
  newEntryId,
  type VaultEntry,
} from "./entries.ts";

export const SHARE_KIND = "4allpass-share-v1";

export interface SharePackage {
  kind: typeof SHARE_KIND;
  snapshot: WireVaultSnapshot;
}

export interface BuiltShare {
  json: string;
  shareKey: string;
  filename: string;
  entryCount: number;
}

const VAULT_KEY_VERSION = 1;

export const SHARE_WARNING =
  "Das verschlüsselt die gewählten Logins in eine Datei plus Share-Schlüssel. 4AllPass sieht keines von beiden. Wer beides hat, kann diese Logins lesen. Eine Kopie holst du nicht zurück. / This encrypts the chosen logins into a file plus a share key. 4AllPass never sees either. Anyone with both can read those logins. You cannot take a copy back.";

export function shareWarning(): string {
  return SHARE_WARNING;
}

export function looksLikeSharePackage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { kind?: unknown };
    return parsed.kind === SHARE_KIND;
  } catch {
    return false;
  }
}

function asSharePackage(value: unknown): SharePackage {
  if (!value || typeof value !== "object") throw new Error("share file is not an object");
  const record = value as { kind?: unknown; snapshot?: unknown };
  if (record.kind !== SHARE_KIND) throw new Error("not a 4AllPass share file");
  if (record.snapshot === undefined) throw new Error("share file has no snapshot");
  return { kind: SHARE_KIND, snapshot: record.snapshot as WireVaultSnapshot };
}

function slug(title: string): string {
  const cleaned = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned.slice(0, 32) || "entry";
}

export function buildSharePackage(entries: readonly VaultEntry[]): BuiltShare {
  if (entries.length === 0) throw new Error("nothing to share");
  const vaultId = `share_${bytesToHex(randomBytes(12))}`;
  const vaultKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  try {
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey,
      vaultId,
      type: "recovery",
      vaultKeyVersion: VAULT_KEY_VERSION,
    });
    const encrypted = entries.map((entry) => {
      const plaintext = encodeEntryPlaintext(entry);
      try {
        return encryptEntry({
          vaultKey,
          vaultId,
          entryId: entry.id,
          plaintext,
          vaultKeyVersion: VAULT_KEY_VERSION,
          schemaVersion: ENTRY_SCHEMA_VERSION,
        });
      } finally {
        zeroize(plaintext);
      }
    });
    const sealedManifest = sealManifest({
      vaultKey,
      manifest: buildManifest({
        vaultId,
        revision: 1,
        vaultKeyVersion: VAULT_KEY_VERSION,
        envelopes: [envelope],
        entries: encrypted,
      }),
    });
    const snapshot = encodeVaultSnapshot({
      vaultId,
      revision: 1,
      vaultKeyVersion: VAULT_KEY_VERSION,
      cryptoProtocolVersion: 1,
      envelopes: [envelope],
      entries: encrypted,
      sealedManifest,
    });
    const json = `${JSON.stringify({ kind: SHARE_KIND, snapshot } satisfies SharePackage, null, 2)}\n`;
    return {
      json,
      shareKey: formatRecoveryKey(recoveryKey),
      filename: `4allpass-share-${slug(entries[0]!.title)}.json`,
      entryCount: entries.length,
    };
  } finally {
    zeroize(vaultKey, recoveryKey, wrappingKey);
  }
}

export function openSharePackage(text: string, shareKeyText: string): VaultEntry[] {
  const pack = asSharePackage(JSON.parse(text) as unknown);
  const snapshot = decodeVaultSnapshot(pack.snapshot);
  const recovery = snapshot.envelopes.find((envelope) => envelope.type === "recovery");
  if (!recovery) throw new Error("share file has no recovery envelope");
  if (!snapshot.sealedManifest) throw new Error("share file is missing a sealed manifest");
  const recoveryKey = parseRecoveryKey(shareKeyText);
  const wrappingKey = deriveRecoveryWrappingKey({
    recoveryKey,
    vaultId: snapshot.vaultId,
  });
  try {
    const vaultKey = unwrapVaultKey(recovery, {
      wrappingKey,
      vaultId: snapshot.vaultId,
      expectType: "recovery",
      expectVaultKeyVersion: snapshot.vaultKeyVersion,
    });
    try {
      verifySnapshotManifest(
        snapshot.sealedManifest,
        { entries: snapshot.entries, envelopes: snapshot.envelopes },
        {
          vaultKey,
          vaultId: snapshot.vaultId,
          revision: snapshot.revision,
          vaultKeyVersion: snapshot.vaultKeyVersion,
        },
      );
      return verifySnapshot({
        vaultId: snapshot.vaultId,
        vaultKey,
        vaultKeyVersion: snapshot.vaultKeyVersion,
        entries: snapshot.entries,
        crossCheckEnvelopes: [{ envelope: recovery, wrappingKey }],
      }).map((entry) => {
        try {
          const decoded = decodeEntryPlaintext(entry.id, entry.plaintext);
          return { ...decoded, id: newEntryId() };
        } finally {
          zeroize(entry.plaintext);
        }
      });
    } finally {
      zeroize(vaultKey);
    }
  } finally {
    zeroize(recoveryKey, wrappingKey);
  }
}

export function downloadShareFile(built: BuiltShare): void {
  const blob = new Blob([built.json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = built.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
