import {
  CRYPTO_PROTOCOL_VERSION,
  DIGEST_BYTES,
  KEY_BYTES,
  MANIFEST_CONTENT_LABEL,
  MANIFEST_ENTRIES_MAX,
  MANIFEST_ENVELOPES_MAX,
  NONCE_BYTES,
  TAG_BYTES,
} from "./constants.ts";
import { assertAeadFraming, decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { manifestAad } from "./encoding/aad.ts";
import { assertKdfBlock } from "./kdf/profiles.ts";
import { entryDigest, envelopeDigest, sealedManifestDigest } from "./encoding/digest.ts";
import { frame } from "./encoding/framing.ts";
import { bytesToHex, compareUtf8, concat } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";
import {
  assertBytes,
  assertEnvelopeType,
  copyBytes,
  assertId,
  assertRecordList,
  assertRevision,
  assertUint32,
  assertVersion,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";
import type {
  EncryptedEntry,
  GcmBox,
  KeyEnvelope,
  ManifestEntryRef,
  ManifestEnvelopeRef,
  SealedManifest,
  SnapshotManifest,
} from "./types.ts";

export interface BuildManifestOptions {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  entries: readonly EncryptedEntry[];
  envelopes: readonly KeyEnvelope[];
  cryptoProtocolVersion?: number;
  /** Same gate as unwrap: ci Argon2id only when tests opt in. */
  allowTestProfile?: boolean;
}

export interface SealManifestOptions {
  vaultKey: Uint8Array;
  manifest: SnapshotManifest;
}

export interface OpenManifestOptions {
  vaultKey: Uint8Array;
  /** The snapshot metadata the server claims. The GCM tag decides whether it is true. */
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion?: number;
  /** Same gate as unwrap. Default false — a weak-KDF master envelope is not digestable. */
  allowTestProfile?: boolean;
}

export interface SnapshotContents {
  entries: readonly EncryptedEntry[];
  envelopes: readonly KeyEnvelope[];
}

/**
 * The result of actually authenticating a sealed manifest: the manifest together
 * with the digest of the exact blob it came out of.
 *
 * These two values are produced together and travel together so that a pin can
 * never record a digest of a blob that was not verified — which would silently
 * turn the equivocation check into noise.
 */
export interface VerifiedManifest {
  manifest: SnapshotManifest;
  sealedDigest: Uint8Array;
}

/**
 * A verified snapshot, including the normalized records the digests were taken
 * over.
 *
 * Callers must decrypt **these** records, not the objects they passed in.
 * Verification commits to the bytes it read; if the application then decrypts its
 * own object, anything that can make a second read return something else (an
 * accessor, a lazily-decoding transport wrapper, a model layer) reopens the gap
 * the manifest exists to close.
 */
export interface VerifiedSnapshot extends VerifiedManifest {
  entries: EncryptedEntry[];
  envelopes: KeyEnvelope[];
}

function envelopeKey(type: string, deviceId: string): string {
  return `${type}\u0000${deviceId}`;
}

/**
 * Canonical order is defined on the UTF-8 encoding, not on UTF-16 code units.
 * JavaScript's `<` compares code units, which orders astral characters
 * differently from their bytes — a second implementation sorting the wire format
 * would then disagree with us about what "canonical" means.
 */
function compare(a: string, b: string): number {
  return compareUtf8(a, b);
}

function assertSorted(label: string, keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    if (compare(keys[i - 1] as string, keys[i] as string) >= 0) {
      throw new ProtocolError(`manifest ${label} are not in canonical order`);
    }
  }
}

/**
 * Copy a record into plain data, reading every field exactly once.
 *
 * The manifest's whole job is to commit to the bytes the client will later
 * decrypt. If the record were validated through one read and digested through a
 * second, an object with accessors instead of data properties could present
 * honest bytes to the checks and stale bytes to the digest — and a snapshot that
 * passed `verifySnapshotManifest` would then decrypt to something else entirely. So the
 * digest is always taken over this normalized copy, never over the input object.
 */
function normalizeEntry(entry: EncryptedEntry): EncryptedEntry {
  const id = assertId("entry.id", entry.id);
  return {
    id,
    schemaVersion: assertVersion("entry.schemaVersion", entry.schemaVersion),
    cryptoVersion: assertVersion("entry.cryptoVersion", entry.cryptoVersion),
    vaultKeyVersion: assertVersion("entry.vaultKeyVersion", entry.vaultKeyVersion),
    nonce: copyBytes(`entry ${id} nonce`, entry.nonce, { exact: NONCE_BYTES }),
    ciphertext: copyBytes(`entry ${id} ciphertext`, entry.ciphertext),
    tag: copyBytes(`entry ${id} tag`, entry.tag, { exact: TAG_BYTES }),
  };
}

function normalizeEnvelope(envelope: KeyEnvelope, allowTestProfile: boolean): KeyEnvelope {
  const type = assertEnvelopeType(envelope.type);
  const record: KeyEnvelope = {
    version: assertVersion("envelope.version", envelope.version),
    type,
    vaultKeyVersion: assertVersion("envelope.vaultKeyVersion", envelope.vaultKeyVersion),
    encryption: "AES-256-GCM",
    nonce: copyBytes(`${type} envelope nonce`, envelope.nonce, { exact: NONCE_BYTES }),
    ciphertext: copyBytes(`${type} envelope ciphertext`, envelope.ciphertext, { exact: KEY_BYTES }),
    tag: copyBytes(`${type} envelope tag`, envelope.tag, { exact: TAG_BYTES }),
  };
  if (envelope.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported envelope encryption: ${String(envelope.encryption)}`);
  }
  const kdf = envelope.kdf;
  if (type === "master") {
    if (!kdf) throw new ProtocolError("master envelope requires kdf parameters");
    record.kdf = assertKdfBlock(kdf, allowTestProfile);
  } else if (kdf) {
    throw new ProtocolError(`${type} envelope must not carry kdf parameters`);
  }
  if (type === "device") {
    record.deviceId = assertId("envelope.deviceId", envelope.deviceId);
    record.deviceKeyVersion = assertVersion("envelope.deviceKeyVersion", envelope.deviceKeyVersion);
  } else {
    if (envelope.deviceId !== undefined && envelope.deviceId !== "") {
      throw new ProtocolError(`${type} envelope must not carry deviceId`);
    }
    if (envelope.deviceKeyVersion !== undefined) {
      throw new ProtocolError(`${type} envelope must not carry deviceKeyVersion`);
    }
  }
  return record;
}

function assertSnapshotHeader(header: {
  vaultId: unknown;
  revision: unknown;
  vaultKeyVersion: unknown;
  cryptoProtocolVersion: unknown;
}): Pick<SnapshotManifest, "vaultId" | "revision" | "vaultKeyVersion" | "cryptoProtocolVersion"> {
  const cryptoProtocolVersion = assertVersion("cryptoProtocolVersion", header.cryptoProtocolVersion);
  if (cryptoProtocolVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported manifest cryptoProtocolVersion: ${cryptoProtocolVersion}`);
  }
  return {
    vaultId: assertId("vaultId", header.vaultId),
    revision: assertRevision("revision", header.revision),
    vaultKeyVersion: assertVersion("vaultKeyVersion", header.vaultKeyVersion),
    cryptoProtocolVersion,
  };
}

/**
 * Describe a snapshot: every entry and every envelope by digest, under one
 * `revision` and one `vaultKeyVersion`.
 *
 * A snapshot has exactly one Vault-Key generation. Mixing generations is
 * rejected here instead of being representable in an authenticated manifest.
 */
export function buildManifest(opts: BuildManifestOptions): SnapshotManifest {
  const header = assertSnapshotHeader({
    vaultId: opts.vaultId,
    revision: opts.revision,
    vaultKeyVersion: opts.vaultKeyVersion,
    cryptoProtocolVersion: opts.cryptoProtocolVersion ?? CRYPTO_PROTOCOL_VERSION,
  });
  return describeSnapshot(header, normalizeSnapshotContents(opts, opts.allowTestProfile === true));
}

/** Copy a snapshot into plain records, reading every field of every record once. */
export function normalizeSnapshotContents(
  contents: SnapshotContents,
  allowTestProfile = false,
): {
  entries: EncryptedEntry[];
  envelopes: KeyEnvelope[];
} {
  const inputEntries = assertRecordList<EncryptedEntry>("entries", contents.entries);
  const inputEnvelopes = assertRecordList<KeyEnvelope>("envelopes", contents.envelopes);
  if (inputEntries.length > MANIFEST_ENTRIES_MAX) {
    throw new ProtocolError(`snapshot has more than ${MANIFEST_ENTRIES_MAX} entries`);
  }
  if (inputEnvelopes.length > MANIFEST_ENVELOPES_MAX) {
    throw new ProtocolError(`snapshot has more than ${MANIFEST_ENVELOPES_MAX} envelopes`);
  }
  return {
    entries: inputEntries.map(normalizeEntry),
    envelopes: inputEnvelopes.map((envelope) => normalizeEnvelope(envelope, allowTestProfile)),
  };
}

function describeSnapshot(
  header: Pick<SnapshotManifest, "vaultId" | "revision" | "vaultKeyVersion" | "cryptoProtocolVersion">,
  normalized: { entries: EncryptedEntry[]; envelopes: KeyEnvelope[] },
): SnapshotManifest {
  const entries: ManifestEntryRef[] = normalized.entries.map((record) => {
    requireSameNumber(
      `entry ${record.id} vaultKeyVersion`,
      header.vaultKeyVersion,
      record.vaultKeyVersion,
    );
    return {
      id: record.id,
      schemaVersion: record.schemaVersion,
      cryptoVersion: record.cryptoVersion,
      vaultKeyVersion: record.vaultKeyVersion,
      digest: entryDigest(record),
    };
  });

  const envelopes: ManifestEnvelopeRef[] = normalized.envelopes.map((record) => {
    requireSameNumber(
      `envelope ${record.type} vaultKeyVersion`,
      header.vaultKeyVersion,
      record.vaultKeyVersion,
    );
    return {
      type: record.type,
      deviceId: record.deviceId ?? "",
      vaultKeyVersion: record.vaultKeyVersion,
      deviceKeyVersion: record.deviceKeyVersion ?? 0,
      digest: envelopeDigest(record),
    };
  });

  return validateManifest({ ...header, entries, envelopes });
}

/**
 * Canonical form check: unique ids, sorted order, one key generation.
 * Canonicality matters because the manifest is the thing being authenticated —
 * two encodings of "the same" snapshot must not exist.
 */
export function validateManifest(manifest: SnapshotManifest): SnapshotManifest {
  const header = assertSnapshotHeader(manifest);
  if (manifest.entries.length > MANIFEST_ENTRIES_MAX || manifest.envelopes.length > MANIFEST_ENVELOPES_MAX) {
    throw new ProtocolError("manifest exceeds size limits");
  }

  const entries = [...manifest.entries].sort((a, b) => compare(a.id, b.id));
  const seenEntries = new Set<string>();
  for (const entry of entries) {
    assertId("manifest entry id", entry.id);
    if (seenEntries.has(entry.id)) {
      throw new ProtocolError(`duplicate entry id in manifest: ${entry.id}`);
    }
    seenEntries.add(entry.id);
    assertVersion("manifest entry schemaVersion", entry.schemaVersion);
    assertVersion("manifest entry cryptoVersion", entry.cryptoVersion);
    requireSameNumber(
      `manifest entry ${entry.id} vaultKeyVersion`,
      header.vaultKeyVersion,
      assertVersion("manifest entry vaultKeyVersion", entry.vaultKeyVersion),
    );
    assertBytes("manifest entry digest", entry.digest, { exact: DIGEST_BYTES });
  }

  const envelopes = [...manifest.envelopes].sort((a, b) =>
    compare(envelopeKey(a.type, a.deviceId), envelopeKey(b.type, b.deviceId)),
  );
  const seenEnvelopes = new Set<string>();
  for (const envelope of envelopes) {
    const type = assertEnvelopeType(envelope.type);
    if (type === "device") {
      assertId("manifest envelope deviceId", envelope.deviceId);
      assertVersion("manifest envelope deviceKeyVersion", envelope.deviceKeyVersion);
    } else {
      if (envelope.deviceId !== "") {
        throw new ProtocolError(`${type} envelope ref must not carry a deviceId`);
      }
      if (envelope.deviceKeyVersion !== 0) {
        throw new ProtocolError(`${type} envelope ref must have deviceKeyVersion 0`);
      }
    }
    const key = envelopeKey(type, envelope.deviceId);
    if (seenEnvelopes.has(key)) {
      throw new ProtocolError(`duplicate envelope in manifest: ${key.replace("\u0000", "/")}`);
    }
    seenEnvelopes.add(key);
    requireSameNumber(
      `manifest envelope ${key.replace("\u0000", "/")} vaultKeyVersion`,
      header.vaultKeyVersion,
      assertVersion("manifest envelope vaultKeyVersion", envelope.vaultKeyVersion),
    );
    assertBytes("manifest envelope digest", envelope.digest, { exact: DIGEST_BYTES });
  }

  return { ...header, entries, envelopes };
}

/** Deterministic byte encoding of a manifest. Two clients must produce the same bytes. */
export function encodeManifest(manifest: SnapshotManifest): Uint8Array {
  const canonical = validateManifest(manifest);
  const parts: Uint8Array[] = [
    frame([
      MANIFEST_CONTENT_LABEL,
      canonical.vaultId,
      canonical.cryptoProtocolVersion,
      canonical.revision,
      canonical.vaultKeyVersion,
      canonical.entries.length,
      canonical.envelopes.length,
    ]),
  ];
  for (const entry of canonical.entries) {
    parts.push(
      frame([entry.id, entry.schemaVersion, entry.cryptoVersion, entry.vaultKeyVersion, entry.digest]),
    );
  }
  for (const envelope of canonical.envelopes) {
    parts.push(
      frame([
        envelope.type,
        envelope.deviceId,
        envelope.vaultKeyVersion,
        envelope.deviceKeyVersion,
        envelope.digest,
      ]),
    );
  }
  return concat(...parts);
}

class FrameReader {
  private offset = 0;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  private readLength(): number {
    if (this.offset + 4 > this.buf.length) {
      throw new ProtocolError("manifest truncated: missing field length");
    }
    const b = this.buf;
    const len =
      (((b[this.offset] ?? 0) << 24) |
        ((b[this.offset + 1] ?? 0) << 16) |
        ((b[this.offset + 2] ?? 0) << 8) |
        (b[this.offset + 3] ?? 0)) >>>
      0;
    this.offset += 4;
    return len;
  }

  bytes(name: string, expected?: number): Uint8Array {
    const len = this.readLength();
    if (this.offset + len > this.buf.length) {
      throw new ProtocolError(`manifest truncated while reading ${name}`);
    }
    const out = this.buf.slice(this.offset, this.offset + len);
    this.offset += len;
    if (expected !== undefined && out.length !== expected) {
      throw new ProtocolError(`manifest field ${name} must be ${expected} bytes`);
    }
    return out;
  }

  string(name: string): string {
    const bytes = this.bytes(name);
    try {
      return this.decoder.decode(bytes);
    } catch {
      throw new ProtocolError(`manifest field ${name} is not valid UTF-8`);
    }
  }

  u32(name: string): number {
    const b = this.bytes(name, 4);
    return ((((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0);
  }

  end(): void {
    if (this.offset !== this.buf.length) {
      throw new ProtocolError("manifest has trailing bytes");
    }
  }
}

export function decodeManifest(bytes: Uint8Array): SnapshotManifest {
  const reader = new FrameReader(assertBytes("manifest", bytes));
  const label = reader.string("label");
  if (label !== MANIFEST_CONTENT_LABEL) {
    throw new ProtocolError(`unexpected manifest label: ${label}`);
  }
  const header = assertSnapshotHeader({
    vaultId: reader.string("vaultId"),
    cryptoProtocolVersion: reader.u32("cryptoProtocolVersion"),
    revision: reader.u32("revision"),
    vaultKeyVersion: reader.u32("vaultKeyVersion"),
  });
  const entryCount = assertUint32("manifest entryCount", reader.u32("entryCount"));
  const envelopeCount = assertUint32("manifest envelopeCount", reader.u32("envelopeCount"));
  if (entryCount > MANIFEST_ENTRIES_MAX) {
    throw new ProtocolError(`manifest declares more than ${MANIFEST_ENTRIES_MAX} entries`);
  }
  if (envelopeCount > MANIFEST_ENVELOPES_MAX) {
    throw new ProtocolError(`manifest declares more than ${MANIFEST_ENVELOPES_MAX} envelopes`);
  }

  const entries: ManifestEntryRef[] = [];
  for (let i = 0; i < entryCount; i++) {
    entries.push({
      id: reader.string("entry.id"),
      schemaVersion: reader.u32("entry.schemaVersion"),
      cryptoVersion: reader.u32("entry.cryptoVersion"),
      vaultKeyVersion: reader.u32("entry.vaultKeyVersion"),
      digest: reader.bytes("entry.digest", DIGEST_BYTES),
    });
  }
  const envelopes: ManifestEnvelopeRef[] = [];
  for (let i = 0; i < envelopeCount; i++) {
    envelopes.push({
      type: assertEnvelopeType(reader.string("envelope.type")),
      deviceId: reader.string("envelope.deviceId"),
      vaultKeyVersion: reader.u32("envelope.vaultKeyVersion"),
      deviceKeyVersion: reader.u32("envelope.deviceKeyVersion"),
      digest: reader.bytes("envelope.digest", DIGEST_BYTES),
    });
  }
  reader.end();

  // The wire order must already be canonical. Silently re-sorting would let two
  // different byte strings decode to the same manifest, so a holder of VK could
  // produce a second encoding of "the same" snapshot with a different digest.
  assertSorted(
    "entries",
    entries.map((entry) => entry.id),
  );
  assertSorted(
    "envelopes",
    envelopes.map((envelope) => envelopeKey(envelope.type, envelope.deviceId)),
  );
  return validateManifest({ ...header, entries, envelopes });
}

function manifestAadOf(header: {
  vaultId: string;
  cryptoProtocolVersion: number;
  revision: number;
  vaultKeyVersion: number;
}): Uint8Array {
  return manifestAad({
    vaultId: header.vaultId,
    cryptoVersion: header.cryptoProtocolVersion,
    revision: header.revision,
    vaultKeyVersion: header.vaultKeyVersion,
  });
}

function buildSealed(cryptoVersion: number, box: GcmBox): SealedManifest {
  return {
    version: cryptoVersion,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
}

/**
 * Seal the manifest under the Vault Key with `revision` and `vaultKeyVersion`
 * in the AAD. From here on the revision number is authenticated: a server can
 * claim any number it likes, but only a holder of VK can produce a manifest
 * that verifies under it.
 */
export function sealManifest(opts: SealManifestOptions): SealedManifest {
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  const manifest = validateManifest(opts.manifest);
  const body = encodeManifest(manifest);
  const sealed = buildSealed(
    manifest.cryptoProtocolVersion,
    encrypt(opts.vaultKey, body, manifestAadOf(manifest)),
  );
  body.fill(0);
  return sealed;
}

/** Test-only seal with a fixed nonce. */
export function sealManifestWithNonce(
  opts: SealManifestOptions & { nonce: Uint8Array },
): SealedManifest {
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  const manifest = validateManifest(opts.manifest);
  const body = encodeManifest(manifest);
  const sealed = buildSealed(
    manifest.cryptoProtocolVersion,
    encryptWithNonce(opts.vaultKey, opts.nonce, body, manifestAadOf(manifest)),
  );
  body.fill(0);
  return sealed;
}

/**
 * Verify a sealed manifest against the snapshot metadata the server offered.
 * Any lie about `vaultId`, `revision` or `vaultKeyVersion` fails the GCM tag;
 * a manifest whose body disagrees with its own AAD fails the equality checks.
 */
export function openManifest(sealed: SealedManifest, opts: OpenManifestOptions): VerifiedManifest {
  if (sealed === null || typeof sealed !== "object") {
    throw new ProtocolError("sealed manifest must be an object");
  }
  if (sealed.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported manifest encryption: ${String(sealed.encryption)}`);
  }
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  // Each byte field is read exactly once, so validation and use cannot disagree.
  const nonce = assertBytes("sealed.nonce", sealed.nonce);
  const ciphertext = assertBytes("sealed.ciphertext", sealed.ciphertext);
  const tag = assertBytes("sealed.tag", sealed.tag);
  assertAeadFraming(nonce, tag);
  const version = assertVersion("sealed.version", sealed.version);
  if (version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported sealed manifest version: ${version}`);
  }

  const claimed = assertSnapshotHeader({
    vaultId: opts.vaultId,
    revision: opts.revision,
    vaultKeyVersion: opts.vaultKeyVersion,
    cryptoProtocolVersion: opts.cryptoProtocolVersion ?? CRYPTO_PROTOCOL_VERSION,
  });
  const plaintext = decrypt(opts.vaultKey, nonce, ciphertext, tag, manifestAadOf(claimed));
  const manifest = decodeManifest(plaintext);
  plaintext.fill(0);

  requireSameString("manifest.vaultId", claimed.vaultId, manifest.vaultId);
  requireSameNumber("manifest.revision", claimed.revision, manifest.revision);
  requireSameNumber("manifest.vaultKeyVersion", claimed.vaultKeyVersion, manifest.vaultKeyVersion);
  requireSameNumber(
    "manifest.cryptoProtocolVersion",
    claimed.cryptoProtocolVersion,
    manifest.cryptoProtocolVersion,
  );
  // The digest is taken over the validated buffers, not over `sealed` again.
  return {
    manifest,
    sealedDigest: sealedManifestDigest({
      version,
      encryption: "AES-256-GCM",
      nonce,
      ciphertext,
      tag,
    }),
  };
}

/**
 * The snapshot must be exactly what the manifest describes: no substituted
 * record, no entry silently dropped (truncation), nothing injected, and no
 * envelope from an earlier snapshot re-attached (revoked-device replay).
 */
export function assertSnapshotMatchesManifest(
  manifest: SnapshotManifest,
  contents: SnapshotContents,
  allowTestProfile = false,
): { entries: EncryptedEntry[]; envelopes: KeyEnvelope[] } {
  const expected = validateManifest(manifest);
  // Everything in `contents` came from the server. A malformed record there is
  // not a local programming error, it is a tampering attempt, and the caller
  // distinguishes the two by error class.
  let normalized: { entries: EncryptedEntry[]; envelopes: KeyEnvelope[] };
  let observed: SnapshotManifest;
  try {
    normalized = normalizeSnapshotContents(contents, allowTestProfile);
    observed = describeSnapshot(expected, normalized);
  } catch (cause) {
    if (cause instanceof IntegrityError) throw cause;
    throw new IntegrityError(
      `snapshot contents are not a valid snapshot: ${(cause as Error).message}`,
    );
  }

  if (observed.entries.length !== expected.entries.length) {
    throw new IntegrityError(
      `snapshot has ${observed.entries.length} entries, manifest declares ${expected.entries.length}`,
    );
  }
  if (observed.envelopes.length !== expected.envelopes.length) {
    throw new IntegrityError(
      `snapshot has ${observed.envelopes.length} envelopes, manifest declares ${expected.envelopes.length}`,
    );
  }
  for (let i = 0; i < expected.entries.length; i++) {
    const want = expected.entries[i];
    const got = observed.entries[i];
    if (!want || !got) throw new IntegrityError("manifest entry list mismatch");
    if (want.id !== got.id) {
      throw new IntegrityError(`snapshot entry ${got.id} is not declared in the manifest`);
    }
    if (bytesToHex(want.digest) !== bytesToHex(got.digest)) {
      throw new IntegrityError(`entry ${got.id} does not match its manifest digest`);
    }
    requireSameNumber(`entry ${got.id} schemaVersion`, want.schemaVersion, got.schemaVersion);
    requireSameNumber(`entry ${got.id} cryptoVersion`, want.cryptoVersion, got.cryptoVersion);
  }
  for (let i = 0; i < expected.envelopes.length; i++) {
    const want = expected.envelopes[i];
    const got = observed.envelopes[i];
    if (!want || !got) throw new IntegrityError("manifest envelope list mismatch");
    const label = `${got.type}${got.deviceId ? `/${got.deviceId}` : ""}`;
    if (want.type !== got.type || want.deviceId !== got.deviceId) {
      throw new IntegrityError(`snapshot envelope ${label} is not declared in the manifest`);
    }
    if (bytesToHex(want.digest) !== bytesToHex(got.digest)) {
      throw new IntegrityError(`envelope ${label} does not match its manifest digest`);
    }
    requireSameNumber(`envelope ${label} deviceKeyVersion`, want.deviceKeyVersion, got.deviceKeyVersion);
  }
  return normalized;
}

/**
 * Open the manifest and check the snapshot contents in one step.
 *
 * Decrypt the returned `entries` and `envelopes`, not the ones you passed in:
 * those are the exact records the manifest digests were computed over.
 */
export function verifySnapshotManifest(
  sealed: SealedManifest,
  contents: SnapshotContents,
  opts: OpenManifestOptions,
): VerifiedSnapshot {
  const verified = openManifest(sealed, opts);
  const normalized = assertSnapshotMatchesManifest(
    verified.manifest,
    contents,
    opts.allowTestProfile === true,
  );
  return { ...verified, entries: normalized.entries, envelopes: normalized.envelopes };
}
