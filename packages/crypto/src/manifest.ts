import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES } from "./constants.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import {
  boxDigestPreimage,
  encodeAad,
  manifestAad,
  manifestBodyHeader,
  manifestHkdfInfo,
  manifestHkdfSalt,
} from "./encoding/aad.ts";
import { assertId, assertLength, assertVersionCounter, concat, equalBytes, u32be } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";
import { assertFreshSnapshot, evaluateRevision } from "./revision.ts";
import type { RevisionAction } from "./revision.ts";
import type {
  EncryptedEntry,
  EnvelopeType,
  KeyEnvelope,
  ManifestEntryCommitment,
  ManifestEnvelopeCommitment,
  SealedManifest,
  VaultManifest,
  VaultRevision,
} from "./types.ts";

const ENVELOPE_TYPES: readonly EnvelopeType[] = ["master", "device", "recovery"];

export interface SealManifestOptions {
  vaultKey: Uint8Array;
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  envelopes: readonly KeyEnvelope[];
  entries: readonly EncryptedEntry[];
  cryptoProtocolVersion?: 1;
}

function revisionFrom(opts: {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: 1;
}): VaultRevision {
  return {
    vaultId: opts.vaultId,
    revision: opts.revision,
    vaultKeyVersion: opts.vaultKeyVersion,
    cryptoProtocolVersion: opts.cryptoProtocolVersion ?? CRYPTO_PROTOCOL_VERSION,
  };
}

export function deriveManifestKey(
  vaultKey: Uint8Array,
  vaultId: string,
  revision: number,
  vaultKeyVersion: number,
  cryptoVersion: number = CRYPTO_PROTOCOL_VERSION,
): Uint8Array {
  assertLength("vaultKey", vaultKey, KEY_BYTES);
  const salt = sha256(manifestHkdfSalt(vaultId));
  const info = manifestHkdfInfo(vaultId, revision, vaultKeyVersion, cryptoVersion);
  return hkdf(sha256, vaultKey, salt, info, KEY_BYTES);
}

export function boxDigest(nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Uint8Array {
  return sha256(boxDigestPreimage(nonce, ciphertext, tag));
}

function envelopeSortKey(type: EnvelopeType, deviceId: string): string {
  return `${type}\0${deviceId}`;
}

function compareUtf8(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function envelopeCommitment(envelope: KeyEnvelope): ManifestEnvelopeCommitment {
  const deviceId = envelope.deviceId ?? "";
  return {
    type: envelope.type,
    deviceId,
    digest: boxDigest(envelope.nonce, envelope.ciphertext, envelope.tag),
  };
}

export function entryCommitment(entry: EncryptedEntry): ManifestEntryCommitment {
  return {
    id: entry.id,
    digest: boxDigest(entry.nonce, entry.ciphertext, entry.tag),
  };
}

function sortEnvelopeCommitments(
  items: readonly ManifestEnvelopeCommitment[],
): ManifestEnvelopeCommitment[] {
  return [...items].sort((a, b) => compareUtf8(envelopeSortKey(a.type, a.deviceId), envelopeSortKey(b.type, b.deviceId)));
}

function sortEntryCommitments(items: readonly ManifestEntryCommitment[]): ManifestEntryCommitment[] {
  return [...items].sort((a, b) => compareUtf8(a.id, b.id));
}

function assertUniqueIds(entries: readonly ManifestEntryCommitment[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new ProtocolError(`duplicate entry id in manifest: ${entry.id}`);
    }
    seen.add(entry.id);
  }
}

function assertUniqueEnvelopes(envelopes: readonly ManifestEnvelopeCommitment[]): void {
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    const key = envelopeSortKey(envelope.type, envelope.deviceId);
    if (seen.has(key)) {
      throw new ProtocolError(`duplicate envelope in manifest: ${envelope.type}/${envelope.deviceId || "-"}`);
    }
    seen.add(key);
  }
}

export function encodeManifestBody(manifest: VaultManifest): Uint8Array {
  const envelopes = sortEnvelopeCommitments(manifest.envelopes);
  const entries = sortEntryCommitments(manifest.entries);
  assertUniqueEnvelopes(envelopes);
  assertUniqueIds(entries);
  const parts: Uint8Array[] = [
    manifestBodyHeader(
      manifest.vaultId,
      manifest.revision,
      manifest.vaultKeyVersion,
      manifest.cryptoProtocolVersion,
    ),
    u32be(envelopes.length),
  ];
  for (const envelope of envelopes) {
    parts.push(encodeAad([envelope.type, envelope.deviceId, envelope.digest]));
  }
  parts.push(u32be(entries.length));
  for (const entry of entries) {
    parts.push(encodeAad([entry.id, entry.digest]));
  }
  return concat(...parts);
}

function readU32(bytes: Uint8Array, offset: number): { value: number; next: number } {
  if (offset + 4 > bytes.length) {
    throw new ProtocolError("truncated manifest body");
  }
  const value =
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0);
  return { value: value >>> 0, next: offset + 4 };
}

function readAadRecord(bytes: Uint8Array, offset: number, fieldCount: number): {
  fields: Uint8Array[];
  next: number;
} {
  const fields: Uint8Array[] = [];
  let cursor = offset;
  for (let i = 0; i < fieldCount; i++) {
    if (cursor + 2 > bytes.length) {
      throw new ProtocolError("truncated manifest AAD record");
    }
    const len = ((bytes[cursor] ?? 0) << 8) | (bytes[cursor + 1] ?? 0);
    cursor += 2;
    if (cursor + len > bytes.length) {
      throw new ProtocolError("truncated manifest AAD field");
    }
    fields.push(bytes.subarray(cursor, cursor + len));
    cursor += len;
  }
  return { fields, next: cursor };
}

function utf8Field(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseEnvelopeType(value: string): EnvelopeType {
  if ((ENVELOPE_TYPES as readonly string[]).includes(value)) {
    return value as EnvelopeType;
  }
  throw new ProtocolError(`unknown envelope type in manifest: ${value}`);
}

export function decodeManifestBody(bytes: Uint8Array): VaultManifest {
  const headerFields = readAadRecord(bytes, 0, 5);
  const [label, vaultIdBytes, revisionBytes, vaultKeyVersionBytes, protoBytes] = headerFields.fields;
  if (!label || new TextDecoder().decode(label) !== "4allpass-manifest-body-v1") {
    throw new ProtocolError("unknown manifest body label");
  }
  if (!vaultIdBytes || !revisionBytes || !vaultKeyVersionBytes || !protoBytes) {
    throw new ProtocolError("incomplete manifest body header");
  }
  if (revisionBytes.length !== 4 || vaultKeyVersionBytes.length !== 4 || protoBytes.length !== 4) {
    throw new ProtocolError("manifest version fields must be uint32be");
  }
  const revision = readU32(revisionBytes, 0).value;
  const vaultKeyVersion = readU32(vaultKeyVersionBytes, 0).value;
  const cryptoProtocolVersion = readU32(protoBytes, 0).value;
  if (cryptoProtocolVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported manifest cryptoProtocolVersion: ${cryptoProtocolVersion}`);
  }

  let cursor = headerFields.next;
  const envCount = readU32(bytes, cursor);
  cursor = envCount.next;
  const envelopes: ManifestEnvelopeCommitment[] = [];
  for (let i = 0; i < envCount.value; i++) {
    const rec = readAadRecord(bytes, cursor, 3);
    const [typeBytes, deviceIdBytes, digest] = rec.fields;
    if (!typeBytes || !deviceIdBytes || !digest) {
      throw new ProtocolError("incomplete envelope commitment");
    }
    if (digest.length !== 32) {
      throw new ProtocolError("envelope digest must be 32 bytes");
    }
    envelopes.push({
      type: parseEnvelopeType(utf8Field(typeBytes)),
      deviceId: utf8Field(deviceIdBytes),
      digest,
    });
    cursor = rec.next;
  }

  const entCount = readU32(bytes, cursor);
  cursor = entCount.next;
  const entries: ManifestEntryCommitment[] = [];
  for (let i = 0; i < entCount.value; i++) {
    const rec = readAadRecord(bytes, cursor, 2);
    const [idBytes, digest] = rec.fields;
    if (!idBytes || !digest) {
      throw new ProtocolError("incomplete entry commitment");
    }
    if (digest.length !== 32) {
      throw new ProtocolError("entry digest must be 32 bytes");
    }
    entries.push({
      id: utf8Field(idBytes),
      digest,
    });
    cursor = rec.next;
  }
  if (cursor !== bytes.length) {
    throw new ProtocolError("manifest body has trailing bytes");
  }

  const manifest: VaultManifest = {
    vaultId: utf8Field(vaultIdBytes),
    revision,
    vaultKeyVersion,
    cryptoProtocolVersion: 1,
    envelopes,
    entries,
  };
  assertUniqueEnvelopes(envelopes);
  assertUniqueIds(entries);
  return manifest;
}

function buildCommitments(
  envelopes: readonly KeyEnvelope[],
  entries: readonly EncryptedEntry[],
): Pick<VaultManifest, "envelopes" | "entries"> {
  return {
    envelopes: sortEnvelopeCommitments(envelopes.map(envelopeCommitment)),
    entries: sortEntryCommitments(entries.map(entryCommitment)),
  };
}

function sealWith(
  opts: SealManifestOptions,
  encryptBox: (key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array) => {
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    tag: Uint8Array;
  },
): SealedManifest {
  assertId("vaultId", opts.vaultId);
  assertVersionCounter("revision", opts.revision);
  assertVersionCounter("vaultKeyVersion", opts.vaultKeyVersion);
  const cryptoProtocolVersion = opts.cryptoProtocolVersion ?? CRYPTO_PROTOCOL_VERSION;
  if (cryptoProtocolVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes manifest version ${CRYPTO_PROTOCOL_VERSION}`);
  }
  const commitments = buildCommitments(opts.envelopes, opts.entries);
  const body: VaultManifest = {
    vaultId: opts.vaultId,
    revision: opts.revision,
    vaultKeyVersion: opts.vaultKeyVersion,
    cryptoProtocolVersion,
    envelopes: commitments.envelopes,
    entries: commitments.entries,
  };
  const key = deriveManifestKey(
    opts.vaultKey,
    opts.vaultId,
    opts.revision,
    opts.vaultKeyVersion,
    cryptoProtocolVersion,
  );
  const aad = manifestAad(opts.vaultId, opts.revision, opts.vaultKeyVersion, cryptoProtocolVersion);
  const box = encryptBox(key, encodeManifestBody(body), aad);
  return {
    version: CRYPTO_PROTOCOL_VERSION,
    vaultId: opts.vaultId,
    revision: opts.revision,
    vaultKeyVersion: opts.vaultKeyVersion,
    cryptoProtocolVersion,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

export function sealManifest(opts: SealManifestOptions): SealedManifest {
  return sealWith(opts, encrypt);
}

export function sealManifestWithNonce(opts: SealManifestOptions & { nonce: Uint8Array }): SealedManifest {
  return sealWith(opts, (key, plaintext, aad) =>
    encryptWithNonce(key, opts.nonce, plaintext, aad),
  );
}

/**
 * Open a sealed manifest. Header numbers are taken from the object (never guessed),
 * then rebound through AAD + HKDF info. A swapped revision header fails AEAD.
 */
export function openManifest(sealed: SealedManifest, vaultKey: Uint8Array): VaultManifest {
  if (sealed.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported manifest version: ${sealed.version}`);
  }
  if (sealed.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported manifest encryption: ${sealed.encryption}`);
  }
  if (sealed.cryptoProtocolVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported manifest cryptoProtocolVersion: ${sealed.cryptoProtocolVersion}`);
  }
  assertId("vaultId", sealed.vaultId);
  assertVersionCounter("revision", sealed.revision);
  assertVersionCounter("vaultKeyVersion", sealed.vaultKeyVersion);
  const key = deriveManifestKey(
    vaultKey,
    sealed.vaultId,
    sealed.revision,
    sealed.vaultKeyVersion,
    sealed.cryptoProtocolVersion,
  );
  const aad = manifestAad(
    sealed.vaultId,
    sealed.revision,
    sealed.vaultKeyVersion,
    sealed.cryptoProtocolVersion,
  );
  const plaintext = decrypt(key, sealed.nonce, sealed.ciphertext, sealed.tag, aad);
  const opened = decodeManifestBody(plaintext);
  if (
    opened.vaultId !== sealed.vaultId ||
    opened.revision !== sealed.revision ||
    opened.vaultKeyVersion !== sealed.vaultKeyVersion ||
    opened.cryptoProtocolVersion !== sealed.cryptoProtocolVersion
  ) {
    throw new IntegrityError("opened manifest fields do not match sealed header");
  }
  return opened;
}

function sameCommitment(
  a: { digest: Uint8Array },
  b: { digest: Uint8Array },
): boolean {
  return equalBytes(a.digest, b.digest);
}

export function assertManifestMatches(
  manifest: VaultManifest,
  envelopes: readonly KeyEnvelope[],
  entries: readonly EncryptedEntry[],
): void {
  const expected = buildCommitments(envelopes, entries);
  if (expected.envelopes.length !== manifest.envelopes.length) {
    throw new IntegrityError(
      `manifest envelope count mismatch: ${manifest.envelopes.length} != ${expected.envelopes.length}`,
    );
  }
  if (expected.entries.length !== manifest.entries.length) {
    throw new IntegrityError(
      `manifest entry count mismatch: ${manifest.entries.length} != ${expected.entries.length}`,
    );
  }
  for (let i = 0; i < expected.envelopes.length; i++) {
    const want = expected.envelopes[i];
    const got = manifest.envelopes[i];
    if (!want || !got || want.type !== got.type || want.deviceId !== got.deviceId || !sameCommitment(want, got)) {
      throw new IntegrityError("snapshot envelopes do not match authenticated manifest");
    }
  }
  for (let i = 0; i < expected.entries.length; i++) {
    const want = expected.entries[i];
    const got = manifest.entries[i];
    if (!want || !got || want.id !== got.id || !sameCommitment(want, got)) {
      throw new IntegrityError("snapshot entries do not match authenticated manifest");
    }
  }
}

export interface AcceptSnapshotOptions {
  lastSeen: VaultRevision | null;
  vaultKey: Uint8Array;
  /** Untrusted server metadata. Must match the sealed (and opened) manifest. */
  claimed: VaultRevision;
  manifest: SealedManifest;
  envelopes: readonly KeyEnvelope[];
  entries: readonly EncryptedEntry[];
}

export interface AcceptedSnapshot {
  action: RevisionAction;
  revision: VaultRevision;
  manifest: VaultManifest;
}

/**
 * Client entry point for a fetched snapshot.
 *
 * 1. Open the sealed manifest (AEAD binds revision / vaultKeyVersion).
 * 2. Refuse claimed metadata that does not match the authenticated header.
 * 3. Run `evaluateRevision` on the authenticated numbers.
 * 4. Check every envelope and entry against the manifest commitments.
 */
export function acceptSnapshot(opts: AcceptSnapshotOptions): AcceptedSnapshot {
  const opened = openManifest(opts.manifest, opts.vaultKey);
  const authenticated: VaultRevision = {
    vaultId: opened.vaultId,
    revision: opened.revision,
    vaultKeyVersion: opened.vaultKeyVersion,
    cryptoProtocolVersion: opened.cryptoProtocolVersion,
  };
  if (
    opts.claimed.vaultId !== authenticated.vaultId ||
    opts.claimed.revision !== authenticated.revision ||
    opts.claimed.vaultKeyVersion !== authenticated.vaultKeyVersion ||
    opts.claimed.cryptoProtocolVersion !== authenticated.cryptoProtocolVersion
  ) {
    throw new IntegrityError("server-claimed revision does not match authenticated manifest");
  }
  const decision = evaluateRevision(opts.lastSeen, authenticated);
  if (!decision.ok) throw decision.error;
  assertManifestMatches(opened, opts.envelopes, opts.entries);
  return { action: decision.action, revision: authenticated, manifest: opened };
}

export function assertAcceptedSnapshot(opts: AcceptSnapshotOptions): RevisionAction {
  return acceptSnapshot(opts).action;
}

/** Convenience: pin after a successful accept. */
export function pinFromManifest(manifest: VaultManifest): VaultRevision {
  return revisionFrom(manifest);
}

export { assertFreshSnapshot };
