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
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { manifestAad } from "./encoding/aad.ts";
import { entryDigest, envelopeDigest } from "./encoding/digest.ts";
import { frame } from "./encoding/framing.ts";
import { bytesToHex, concat } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";
import {
  assertBytes,
  assertId,
  assertRevision,
  assertUint32,
  assertVersion,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";
import type {
  EncryptedEntry,
  EnvelopeType,
  GcmBox,
  KeyEnvelope,
  ManifestEntryRef,
  ManifestEnvelopeRef,
  SealedManifest,
  SnapshotManifest,
} from "./types.ts";

const ENVELOPE_TYPES: readonly EnvelopeType[] = ["master", "device", "recovery"];

export interface BuildManifestOptions {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  entries: readonly EncryptedEntry[];
  envelopes: readonly KeyEnvelope[];
  cryptoProtocolVersion?: number;
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
}

export interface SnapshotContents {
  entries: readonly EncryptedEntry[];
  envelopes: readonly KeyEnvelope[];
}

function envelopeKey(type: string, deviceId: string): string {
  return `${type}\u0000${deviceId}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertEnvelopeType(value: unknown): EnvelopeType {
  if (typeof value !== "string" || !ENVELOPE_TYPES.includes(value as EnvelopeType)) {
    throw new ProtocolError(`unsupported envelope type: ${String(value)}`);
  }
  return value as EnvelopeType;
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
  if (opts.entries.length > MANIFEST_ENTRIES_MAX) {
    throw new ProtocolError(`snapshot has more than ${MANIFEST_ENTRIES_MAX} entries`);
  }
  if (opts.envelopes.length > MANIFEST_ENVELOPES_MAX) {
    throw new ProtocolError(`snapshot has more than ${MANIFEST_ENVELOPES_MAX} envelopes`);
  }

  const entries: ManifestEntryRef[] = opts.entries.map((entry) => {
    requireSameNumber(
      `entry ${String(entry.id)} vaultKeyVersion`,
      header.vaultKeyVersion,
      assertVersion("entry.vaultKeyVersion", entry.vaultKeyVersion),
    );
    return {
      id: assertId("entry.id", entry.id),
      schemaVersion: assertVersion("entry.schemaVersion", entry.schemaVersion),
      cryptoVersion: assertVersion("entry.cryptoVersion", entry.cryptoVersion),
      vaultKeyVersion: header.vaultKeyVersion,
      digest: entryDigest(entry),
    };
  });

  const envelopes: ManifestEnvelopeRef[] = opts.envelopes.map((envelope) => {
    const type = assertEnvelopeType(envelope.type);
    requireSameNumber(
      `envelope ${type} vaultKeyVersion`,
      header.vaultKeyVersion,
      assertVersion("envelope.vaultKeyVersion", envelope.vaultKeyVersion),
    );
    return {
      type,
      deviceId: type === "device" ? assertId("envelope.deviceId", envelope.deviceId) : "",
      vaultKeyVersion: header.vaultKeyVersion,
      deviceKeyVersion:
        type === "device"
          ? assertVersion("envelope.deviceKeyVersion", envelope.deviceKeyVersion)
          : 0,
      digest: envelopeDigest(envelope),
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

  constructor(private readonly buf: Uint8Array) {}

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
export function openManifest(sealed: SealedManifest, opts: OpenManifestOptions): SnapshotManifest {
  if (sealed === null || typeof sealed !== "object") {
    throw new ProtocolError("sealed manifest must be an object");
  }
  if (sealed.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported manifest encryption: ${String(sealed.encryption)}`);
  }
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  assertBytes("sealed.nonce", sealed.nonce, { exact: NONCE_BYTES });
  assertBytes("sealed.ciphertext", sealed.ciphertext, { min: 1 });
  assertBytes("sealed.tag", sealed.tag, { exact: TAG_BYTES });
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
  const plaintext = decrypt(
    opts.vaultKey,
    sealed.nonce,
    sealed.ciphertext,
    sealed.tag,
    manifestAadOf(claimed),
  );
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
  return manifest;
}

/**
 * The snapshot must be exactly what the manifest describes: no substituted
 * record, no entry silently dropped (truncation), nothing injected, and no
 * envelope from an earlier snapshot re-attached (revoked-device replay).
 */
export function assertSnapshotMatchesManifest(
  manifest: SnapshotManifest,
  contents: SnapshotContents,
): void {
  const expected = validateManifest(manifest);
  const observed = buildManifest({
    vaultId: expected.vaultId,
    revision: expected.revision,
    vaultKeyVersion: expected.vaultKeyVersion,
    cryptoProtocolVersion: expected.cryptoProtocolVersion,
    entries: contents.entries,
    envelopes: contents.envelopes,
  });

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
}

/** Open the manifest and check the snapshot contents in one step. */
export function verifySnapshot(
  sealed: SealedManifest,
  contents: SnapshotContents,
  opts: OpenManifestOptions,
): SnapshotManifest {
  const manifest = openManifest(sealed, opts);
  assertSnapshotMatchesManifest(manifest, contents);
  return manifest;
}
