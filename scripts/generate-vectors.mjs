#!/usr/bin/env node
/**
 * Regenerate the machine-readable v1 test vectors.
 *
 * Everything in here is implemented independently of `packages/crypto`:
 * AES-GCM and HKDF come from node:crypto (OpenSSL), and the AAD / framing /
 * manifest encoders are written out longhand from the specification. That is
 * what keeps `docs/test-vectors/*.json` a cross-implementation known-answer
 * suite instead of a snapshot of the TypeScript code.
 *
 * Usage (from repo root):
 *   node scripts/generate-vectors.mjs
 *   node scripts/generate-vectors.mjs --print-markdown
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vectorDir = join(root, "docs", "test-vectors");

// ---------------------------------------------------------------- primitives

const hex = (buf) => Buffer.from(buf).toString("hex");
const fromHex = (h) => Buffer.from(h ?? "", "hex");
const utf8 = (s) => Buffer.from(s, "utf8");
const sha256 = (buf) => createHash("sha256").update(buf).digest();

function u16be(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** AAD: uint16be(len) || bytes, per field. */
function encodeAad(fields) {
  const parts = [];
  for (const field of fields) {
    const bytes = typeof field === "string" ? utf8(field) : Buffer.from(field);
    if (bytes.length > 0xffff) throw new Error("AAD field too long");
    parts.push(u16be(bytes.length), bytes);
  }
  return Buffer.concat(parts);
}

/** Digest preimage framing: uint32be(len) || bytes, per field. Numbers are uint32be. */
function frame(fields) {
  const parts = [];
  for (const field of fields) {
    const bytes =
      typeof field === "string" ? utf8(field) : typeof field === "number" ? u32be(field) : Buffer.from(field);
    parts.push(u32be(bytes.length), bytes);
  }
  return Buffer.concat(parts);
}

function encrypt(key, nonce, plaintext, aad) {
  const c = createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(aad);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext, tag: c.getAuthTag() };
}

function decrypts(key, nonce, ciphertext, tag, aad) {
  try {
    const d = createDecipheriv("aes-256-gcm", key, nonce);
    d.setAAD(aad);
    d.setAuthTag(tag);
    Buffer.concat([d.update(ciphertext), d.final()]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- v1 labels

const L = {
  envelope: "4allpass-envelope-v1",
  entry: "4allpass-entry-v1",
  deviceKey: "4allpass-device-key-v1",
  manifest: "4allpass-manifest-v1",
  prf: "4allpass-webauthn-prf-v1",
  dwkSalt: "4allpass-dwk-salt-v1",
  dwkInfo: "4allpass-device-wrap-v1",
  rwkSalt: "4allpass-rwk-salt-v1",
  rwkInfo: "4allpass-recovery-wrap-v1",
  kdfParams: "4allpass-kdf-params-v1",
  manifestContent: "4allpass-manifest-content-v1",
  entryDigest: "4allpass-entry-digest-v1",
  envelopeDigest: "4allpass-envelope-digest-v1",
  recoveryChecksum: "4allpass-recovery-checksum-v1",
};

const kdfParamsDigest = (kdf) =>
  sha256(
    frame([
      L.kdfParams,
      kdf.algorithm,
      kdf.version,
      kdf.memory,
      kdf.iterations,
      kdf.parallelism,
      kdf.hashLen,
      fromHex(kdf.salt_hex),
    ]),
  );

const envelopeAad = ({ vaultId, type, cryptoVersion, vaultKeyVersion, deviceId, deviceKeyVersion, kdf }) =>
  encodeAad([
    L.envelope,
    vaultId,
    type,
    u32be(cryptoVersion),
    u32be(vaultKeyVersion),
    deviceId,
    u32be(deviceKeyVersion),
    kdf ? kdfParamsDigest(kdf) : Buffer.alloc(0),
  ]);

const entryAad = ({ vaultId, entryId, schemaVersion, cryptoVersion, vaultKeyVersion }) =>
  encodeAad([
    L.entry,
    vaultId,
    entryId,
    u32be(schemaVersion),
    u32be(cryptoVersion),
    u32be(vaultKeyVersion),
  ]);

const deviceKeyAad = ({ vaultId, deviceId, credentialId, cryptoVersion, deviceKeyVersion }) =>
  encodeAad([
    L.deviceKey,
    vaultId,
    deviceId,
    credentialId,
    u32be(cryptoVersion),
    u32be(deviceKeyVersion),
  ]);

const manifestAad = ({ vaultId, cryptoVersion, revision, vaultKeyVersion }) =>
  encodeAad([L.manifest, vaultId, u32be(cryptoVersion), u32be(revision), u32be(vaultKeyVersion)]);

const entryDigest = (entry) =>
  sha256(
    frame([
      L.entryDigest,
      entry.id,
      entry.schemaVersion,
      entry.cryptoVersion,
      entry.vaultKeyVersion,
      fromHex(entry.nonce),
      fromHex(entry.ciphertext),
      fromHex(entry.tag),
    ]),
  );

const envelopeDigest = (envelope) =>
  sha256(
    frame([
      L.envelopeDigest,
      envelope.type,
      envelope.deviceId ?? "",
      envelope.version,
      envelope.vaultKeyVersion,
      envelope.deviceKeyVersion ?? 0,
      envelope.kdf ? kdfParamsDigest(envelope.kdf) : Buffer.alloc(0),
      fromHex(envelope.nonce),
      fromHex(envelope.ciphertext),
      fromHex(envelope.tag),
    ]),
  );

function encodeManifest(manifest) {
  const parts = [
    frame([
      L.manifestContent,
      manifest.vaultId,
      manifest.cryptoProtocolVersion,
      manifest.revision,
      manifest.vaultKeyVersion,
      manifest.entries.length,
      manifest.envelopes.length,
    ]),
  ];
  for (const e of [...manifest.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    parts.push(frame([e.id, e.schemaVersion, e.cryptoVersion, e.vaultKeyVersion, e.digest]));
  }
  const key = (x) => `${x.type}\u0000${x.deviceId}`;
  for (const e of [...manifest.envelopes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    parts.push(frame([e.type, e.deviceId, e.vaultKeyVersion, e.deviceKeyVersion, e.digest]));
  }
  return Buffer.concat(parts);
}

// Crockford Base32 for the Emergency Kit.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function base32Encode(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  return out;
}

// ---------------------------------------------------------------- constants

const C = {
  vault_id: "vault_01HZX4ALLPASS000000000001",
  entry_id: "entry_01HZX4ALLPASS0000000000A1",
  device_id: "dev_macbook_chrome_profile_1",
  rp_id: "pass.example.local",
  credential_id: "cafebabecafebabecafebabecafebabe",
  crypto_version: 1,
  schema_version: 1,
  vault_key_version: 3,
  device_key_version: 2,
  revision: 42,
  vault_key: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  master_key: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
  device_key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  recovery_key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  prf_output: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  device_key_prf: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
};

/** The `ci` Argon2id profile with a fixed salt. Pinned because the master
 *  envelope AAD now covers a digest of exactly these parameters. */
const KDF = {
  algorithm: "argon2id",
  version: 0x13,
  memory: 32,
  iterations: 3,
  parallelism: 4,
  hashLen: 32,
  salt_hex: "00112233445566778899aabbccddeeff",
};

const ENTRY_JSON =
  '{"title":"Example","username":"daniel","password":"correct-horse-battery-staple","url":"https://example.com","notes":"","totp":null,"custom":[]}';

const bulk = Buffer.alloc(1024);
for (let i = 0; i < bulk.length; i++) bulk[i] = i & 0xff;

// ---------------------------------------------------------------- aes-gcm-v1

const aadEnvelopeMaster = envelopeAad({
  vaultId: C.vault_id,
  type: "master",
  cryptoVersion: C.crypto_version,
  vaultKeyVersion: C.vault_key_version,
  deviceId: "",
  deviceKeyVersion: 0,
  kdf: KDF,
});
const aadEnvelopeDevice = envelopeAad({
  vaultId: C.vault_id,
  type: "device",
  cryptoVersion: C.crypto_version,
  vaultKeyVersion: C.vault_key_version,
  deviceId: C.device_id,
  deviceKeyVersion: C.device_key_version,
});
const aadEnvelopeRecovery = envelopeAad({
  vaultId: C.vault_id,
  type: "recovery",
  cryptoVersion: C.crypto_version,
  vaultKeyVersion: C.vault_key_version,
  deviceId: "",
  deviceKeyVersion: 0,
});
const aadEntry = entryAad({
  vaultId: C.vault_id,
  entryId: C.entry_id,
  schemaVersion: C.schema_version,
  cryptoVersion: C.crypto_version,
  vaultKeyVersion: C.vault_key_version,
});
const aadManifest = manifestAad({
  vaultId: C.vault_id,
  cryptoVersion: C.crypto_version,
  revision: C.revision,
  vaultKeyVersion: C.vault_key_version,
});
const aadDeviceKey = deviceKeyAad({
  vaultId: C.vault_id,
  deviceId: C.device_id,
  credentialId: fromHex(C.credential_id),
  cryptoVersion: C.crypto_version,
  deviceKeyVersion: C.device_key_version,
});

function vector(id, purpose, key, nonce, aad, plaintext, notes = null) {
  const { ciphertext, tag } = encrypt(fromHex(key), fromHex(nonce), plaintext, aad);
  return {
    id,
    purpose,
    expect: "decrypt_ok",
    key,
    nonce,
    aad: hex(aad),
    plaintext: hex(plaintext),
    ciphertext: hex(ciphertext),
    tag: hex(tag),
    notes,
  };
}

const nist = [
  {
    id: "TV-NIST-01",
    purpose: "External interop: AES-256-GCM, empty key/nonce/plaintext, no AAD",
    expect: "decrypt_ok",
    key: "00".repeat(32),
    nonce: "00".repeat(12),
    aad: "",
    plaintext: "",
  },
  {
    id: "TV-NIST-02",
    purpose: "External interop: 16 zero bytes plaintext, no AAD",
    expect: "decrypt_ok",
    key: "00".repeat(32),
    nonce: "00".repeat(12),
    aad: "",
    plaintext: "00".repeat(16),
  },
  {
    id: "TV-NIST-03",
    purpose: "External interop: AAD changes the tag only",
    expect: "decrypt_ok",
    key: "00".repeat(32),
    nonce: "00".repeat(12),
    aad: "00".repeat(16),
    plaintext: "00".repeat(16),
  },
].map((v) => {
  const { ciphertext, tag } = encrypt(fromHex(v.key), fromHex(v.nonce), fromHex(v.plaintext), fromHex(v.aad));
  return { ...v, ciphertext: hex(ciphertext), tag: hex(tag), notes: null };
});

const tvGcm01 = vector(
  "TV-GCM-01",
  "Primitive interop: AES-256-GCM, empty AAD, short plaintext",
  C.vault_key,
  "000000000000000000000001",
  Buffer.alloc(0),
  utf8("hello 4AllPass"),
  { plaintext_utf8: "hello 4AllPass" },
);
const tvGcm02 = vector(
  "TV-GCM-02",
  "Auth-only: empty plaintext, nonempty AAD",
  C.vault_key,
  "000000000000000000000002",
  encodeAad(["4allpass-auth-only"]),
  Buffer.alloc(0),
);
const tvGcm03 = vector(
  "TV-GCM-03",
  "Longer payload (1024 bytes, repeating 0x00-0xff)",
  C.vault_key,
  "000000000000000000000003",
  encodeAad(["4allpass-bulk-v1"]),
  bulk,
);
const tvEnvMaster = vector(
  "TV-ENV-MASTER",
  "Master envelope: VK wrapped under MK, AAD binds vaultKeyVersion and the KDF parameter digest",
  C.master_key,
  "0102030405060708090a0b0c",
  aadEnvelopeMaster,
  fromHex(C.vault_key),
  { envelope_type: "master", vault_key_version: C.vault_key_version, kdf: KDF },
);
const tvEnvDevice = vector(
  "TV-ENV-DEVICE",
  "Device envelope: VK wrapped under DK, AAD binds deviceId and deviceKeyVersion",
  C.device_key,
  "ffffffffffffffffffffffff",
  aadEnvelopeDevice,
  fromHex(C.vault_key),
  { envelope_type: "device", device_key_version: C.device_key_version },
);
const tvEnvRecovery = vector(
  "TV-ENV-RECOVERY",
  "Recovery envelope: VK wrapped under the Recovery Wrapping Key (see recovery-v1.json)",
  C.recovery_key,
  "deadbeefdeadbeefdeadbeef",
  aadEnvelopeRecovery,
  fromHex(C.vault_key),
  { envelope_type: "recovery" },
);
const tvEntry01 = vector(
  "TV-ENTRY-01",
  "Vault entry JSON sealed under VK, AAD binds schemaVersion, cryptoVersion and vaultKeyVersion",
  C.vault_key,
  "111111111111111111111111",
  aadEntry,
  utf8(ENTRY_JSON),
  { plaintext_utf8: ENTRY_JSON, vault_key_version: C.vault_key_version },
);

// The manifest describes the snapshot that TV-ENV-* / TV-ENTRY-01 belong to.
const manifest = {
  vaultId: C.vault_id,
  revision: C.revision,
  vaultKeyVersion: C.vault_key_version,
  cryptoProtocolVersion: C.crypto_version,
  entries: [
    {
      id: C.entry_id,
      schemaVersion: C.schema_version,
      cryptoVersion: C.crypto_version,
      vaultKeyVersion: C.vault_key_version,
      digest: entryDigest({
        id: C.entry_id,
        schemaVersion: C.schema_version,
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        nonce: tvEntry01.nonce,
        ciphertext: tvEntry01.ciphertext,
        tag: tvEntry01.tag,
      }),
    },
  ],
  envelopes: [
    {
      type: "master",
      deviceId: "",
      vaultKeyVersion: C.vault_key_version,
      deviceKeyVersion: 0,
      digest: envelopeDigest({
        type: "master",
        version: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        kdf: KDF,
        nonce: tvEnvMaster.nonce,
        ciphertext: tvEnvMaster.ciphertext,
        tag: tvEnvMaster.tag,
      }),
    },
    {
      type: "device",
      deviceId: C.device_id,
      vaultKeyVersion: C.vault_key_version,
      deviceKeyVersion: C.device_key_version,
      digest: envelopeDigest({
        type: "device",
        deviceId: C.device_id,
        version: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        deviceKeyVersion: C.device_key_version,
        nonce: tvEnvDevice.nonce,
        ciphertext: tvEnvDevice.ciphertext,
        tag: tvEnvDevice.tag,
      }),
    },
    {
      type: "recovery",
      deviceId: "",
      vaultKeyVersion: C.vault_key_version,
      deviceKeyVersion: 0,
      digest: envelopeDigest({
        type: "recovery",
        version: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        nonce: tvEnvRecovery.nonce,
        ciphertext: tvEnvRecovery.ciphertext,
        tag: tvEnvRecovery.tag,
      }),
    },
  ],
};
const manifestBody = encodeManifest(manifest);
const tvManifest = vector(
  "TV-MANIFEST-01",
  "Snapshot manifest sealed under VK; AAD binds revision and vaultKeyVersion",
  C.vault_key,
  "222222222222222222222222",
  aadManifest,
  manifestBody,
  {
    revision: C.revision,
    entry_digest: hex(manifest.entries[0].digest),
    envelope_digests: manifest.envelopes.map((e) => ({
      type: e.type,
      device_id: e.deviceId,
      digest: hex(e.digest),
    })),
  },
);

function tamper(id, purpose, base, overrides) {
  const v = { ...base, ...overrides, id, purpose, expect: "auth_fail", notes: null };
  delete v.plaintext;
  if (decrypts(fromHex(v.key), fromHex(v.nonce), fromHex(v.ciphertext), fromHex(v.tag), fromHex(v.aad))) {
    throw new Error(`${id} unexpectedly decrypts`);
  }
  return v;
}

const flipFirst = (h) => {
  const b = fromHex(h);
  b[0] ^= 0x01;
  return hex(b);
};

const tamperVectors = [
  tamper("TV-TAMPER-CT", "First ciphertext byte flipped", tvGcm01, { ciphertext: flipFirst(tvGcm01.ciphertext) }),
  tamper("TV-TAMPER-TAG", "First tag byte flipped", tvGcm01, { tag: flipFirst(tvGcm01.tag) }),
  tamper("TV-TAMPER-AAD", "AAD replaced", tvGcm01, { aad: hex(encodeAad(["wrong"])) }),
  tamper("TV-TAMPER-NONCE", "Nonce replaced", tvGcm01, { nonce: "000000000000000000000002" }),
  tamper("TV-TAMPER-KEY", "Wrong key", tvGcm01, { key: C.master_key }),
  tamper("TV-TAMPER-TYPE", "Master envelope opened as a device envelope", tvEnvMaster, {
    aad: hex(aadEnvelopeDevice),
  }),
  tamper("TV-TAMPER-CROSS-VAULT", "Entry AAD vault_id swapped", tvEntry01, {
    aad: hex(
      entryAad({
        vaultId: "vault_01HZX4ALLPASS000000000002",
        entryId: C.entry_id,
        schemaVersion: C.schema_version,
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
      }),
    ),
  }),
  tamper("TV-TAMPER-CROSS-ENTRY", "Entry AAD entry_id swapped (record moved to another slot)", tvEntry01, {
    aad: hex(
      entryAad({
        vaultId: C.vault_id,
        entryId: "entry_01HZX4ALLPASS0000000000B2",
        schemaVersion: C.schema_version,
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
      }),
    ),
  }),
  tamper("TV-TAMPER-SCHEMA-VERSION", "Entry AAD schema_version downgraded", tvEntry01, {
    aad: hex(
      entryAad({
        vaultId: C.vault_id,
        entryId: C.entry_id,
        schemaVersion: 2,
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
      }),
    ),
  }),
  tamper("TV-TAMPER-VAULT-KEY-VERSION", "Entry AAD vault_key_version rolled back", tvEntry01, {
    aad: hex(
      entryAad({
        vaultId: C.vault_id,
        entryId: C.entry_id,
        schemaVersion: C.schema_version,
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version - 1,
      }),
    ),
  }),
  tamper("TV-TAMPER-KDF-PARAMS", "Master envelope KDF parameters weakened (memory 32 -> 8 KiB)", tvEnvMaster, {
    aad: hex(
      envelopeAad({
        vaultId: C.vault_id,
        type: "master",
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        deviceId: "",
        deviceKeyVersion: 0,
        kdf: { ...KDF, memory: 8, iterations: 1, parallelism: 1 },
      }),
    ),
  }),
  tamper("TV-TAMPER-KDF-SALT", "Master envelope KDF salt swapped", tvEnvMaster, {
    aad: hex(
      envelopeAad({
        vaultId: C.vault_id,
        type: "master",
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        deviceId: "",
        deviceKeyVersion: 0,
        kdf: { ...KDF, salt_hex: "ffeeddccbbaa99887766554433221100" },
      }),
    ),
  }),
  tamper("TV-TAMPER-DEVICE-KEY-VERSION", "Device envelope deviceKeyVersion rolled back", tvEnvDevice, {
    aad: hex(
      envelopeAad({
        vaultId: C.vault_id,
        type: "device",
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        deviceId: C.device_id,
        deviceKeyVersion: C.device_key_version - 1,
      }),
    ),
  }),
  tamper("TV-TAMPER-CROSS-DEVICE", "Device envelope claimed for another device", tvEnvDevice, {
    aad: hex(
      envelopeAad({
        vaultId: C.vault_id,
        type: "device",
        cryptoVersion: C.crypto_version,
        vaultKeyVersion: C.vault_key_version,
        deviceId: "dev_attacker_phone",
        deviceKeyVersion: C.device_key_version,
      }),
    ),
  }),
  tamper("TV-TAMPER-REVISION", "Manifest replayed under a higher revision number", tvManifest, {
    aad: hex(
      manifestAad({
        vaultId: C.vault_id,
        cryptoVersion: C.crypto_version,
        revision: C.revision + 8,
        vaultKeyVersion: C.vault_key_version,
      }),
    ),
  }),
  tamper("TV-TAMPER-MANIFEST-KEY-VERSION", "Manifest replayed under another vault_key_version", tvManifest, {
    aad: hex(
      manifestAad({
        vaultId: C.vault_id,
        cryptoVersion: C.crypto_version,
        revision: C.revision,
        vaultKeyVersion: C.vault_key_version + 1,
      }),
    ),
  }),
];

const aesSuite = {
  protocol: "4AllPass Crypto Protocol v1",
  primitive: "AES-256-GCM",
  generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  generator: "node scripts/generate-vectors.mjs (node:crypto createCipheriv aes-256-gcm, OpenSSL)",
  conventions: {
    hex: "lowercase, no 0x prefix, no separators",
    nonce_bytes: 12,
    tag_bytes: 16,
    key_bytes: 32,
    ciphertext_excludes_tag: true,
    aad_encoding: "concat(uint16be(len) || field_bytes) for each field",
    digest_encoding: "sha256(concat(uint32be(len) || field_bytes)) for each field",
  },
  constants: {
    vault_id: C.vault_id,
    entry_id: C.entry_id,
    device_id: C.device_id,
    crypto_version: C.crypto_version,
    schema_version: C.schema_version,
    vault_key_version: C.vault_key_version,
    device_key_version: C.device_key_version,
    revision: C.revision,
    vault_key: C.vault_key,
    master_key: C.master_key,
    device_key: C.device_key,
    recovery_key: C.recovery_key,
    kdf: {
      algorithm: KDF.algorithm,
      version: KDF.version,
      memory_kib: KDF.memory,
      iterations: KDF.iterations,
      parallelism: KDF.parallelism,
      hash_len: KDF.hashLen,
      salt: KDF.salt_hex,
      profile: "ci",
      note: "test-only profile; pinned because the master envelope AAD covers its digest",
    },
    kdf_params_digest: hex(kdfParamsDigest(KDF)),
  },
  aad_construction: {
    envelope_fields: [
      L.envelope,
      "vault_id",
      "type",
      "crypto_version_u32be",
      "vault_key_version_u32be",
      "device_id_or_empty",
      "device_key_version_u32be",
      "kdf_params_digest_or_empty",
    ],
    entry_fields: [
      L.entry,
      "vault_id",
      "entry_id",
      "schema_version_u32be",
      "crypto_version_u32be",
      "vault_key_version_u32be",
    ],
    manifest_fields: [L.manifest, "vault_id", "crypto_version_u32be", "revision_u32be", "vault_key_version_u32be"],
    kdf_params_digest_fields: [
      L.kdfParams,
      "algorithm",
      "argon2_version_u32be",
      "memory_kib_u32be",
      "iterations_u32be",
      "parallelism_u32be",
      "hash_len_u32be",
      "salt",
    ],
    hex: {
      envelope_master: hex(aadEnvelopeMaster),
      envelope_device: hex(aadEnvelopeDevice),
      envelope_recovery: hex(aadEnvelopeRecovery),
      entry: hex(aadEntry),
      manifest: hex(aadManifest),
    },
  },
  manifest: {
    id: "TV-MANIFEST-BODY",
    purpose: "Canonical manifest body for the snapshot formed by TV-ENV-* and TV-ENTRY-01",
    revision: C.revision,
    vault_key_version: C.vault_key_version,
    content_label: L.manifestContent,
    entries: manifest.entries.map((e) => ({ id: e.id, digest: hex(e.digest) })),
    envelopes: manifest.envelopes.map((e) => ({
      type: e.type,
      device_id: e.deviceId,
      device_key_version: e.deviceKeyVersion,
      digest: hex(e.digest),
    })),
    body: hex(manifestBody),
    body_sha256: hex(sha256(manifestBody)),
  },
  success: [tvGcm01, tvGcm02, tvGcm03, tvEnvMaster, tvEnvDevice, tvEnvRecovery, tvEntry01, tvManifest],
  tamper: tamperVectors,
  nist,
  verified_with: ["node:crypto (OpenSSL) AES-256-GCM", "@noble/ciphers AES-GCM via packages/crypto tests"],
};

// ------------------------------------------------------------- device-prf-v1

const prfEvalFirstInput = encodeAad([L.prf, C.rp_id, C.vault_id]);
const prfEvalFirst = sha256(prfEvalFirstInput);
const dwkSaltPreimage = encodeAad([L.dwkSalt, C.vault_id, fromHex(C.credential_id)]);
const dwkInfo = encodeAad([
  L.dwkInfo,
  C.rp_id,
  C.vault_id,
  C.device_id,
  fromHex(C.credential_id),
  u32be(C.crypto_version),
]);
const dwk = Buffer.from(
  hkdfSync("sha256", fromHex(C.prf_output), sha256(dwkSaltPreimage), dwkInfo, 32),
);
const dke = encrypt(dwk, fromHex("0102030405060708090a0b0c"), fromHex(C.device_key_prf), aadDeviceKey);

const deviceSuite = {
  protocol: "4AllPass Crypto Protocol v1",
  primitive: "WebAuthn-PRF + HKDF-SHA-256 + AES-256-GCM device-key wrap",
  generated: aesSuite.generated,
  generator: aesSuite.generator,
  verified_with: ["node:crypto hkdfSync/sha256", "@noble/hashes hkdf via packages/crypto tests"],
  constants: {
    vault_id: C.vault_id,
    device_id: C.device_id,
    rp_id: C.rp_id,
    credential_id: C.credential_id,
    prf_output: C.prf_output,
    device_key: C.device_key_prf,
    crypto_version: C.crypto_version,
    device_key_version: C.device_key_version,
  },
  aad_construction: {
    device_key_fields: [
      L.deviceKey,
      "vault_id",
      "device_id",
      "credential_id",
      "crypto_version_u32be",
      "device_key_version_u32be",
    ],
    hex: { device_key: hex(aadDeviceKey) },
  },
  success: [
    {
      id: "TV-PRF-EVAL-FIRST",
      purpose: "SHA-256 of length-prefixed PRF context → WebAuthn prf.eval.first",
      prf_eval_first_input: hex(prfEvalFirstInput),
      prf_eval_first: hex(prfEvalFirst),
    },
    {
      id: "TV-DWK-01",
      purpose: "HKDF-SHA-256 Device Wrapping Key from a fixed 32-byte PRF output",
      prf_output: C.prf_output,
      hkdf_salt_preimage: hex(dwkSaltPreimage),
      hkdf_info: hex(dwkInfo),
      device_wrapping_key: hex(dwk),
    },
    {
      id: "TV-DKE-01",
      purpose: "Wrap the Device Key under DWK; AAD binds vault, device, credential and deviceKeyVersion",
      key: hex(dwk),
      nonce: "0102030405060708090a0b0c",
      aad: hex(aadDeviceKey),
      device_key_version: C.device_key_version,
      plaintext: C.device_key_prf,
      ciphertext: hex(dke.ciphertext),
      tag: hex(dke.tag),
    },
  ],
  negative: [
    {
      id: "TV-DWK-WRONG-VAULT",
      purpose: "Different vault_id must produce a different DWK",
      vault_id: "vault_OTHER",
      expect: "dk_differs",
      differs_from: "TV-DWK-01",
    },
    {
      id: "TV-DKE-WRONG-DWK",
      purpose: "Wrong DWK must not unwrap TV-DKE-01",
      expect: "auth_fail",
      key: "ff".repeat(32),
      nonce: "0102030405060708090a0b0c",
      aad: hex(aadDeviceKey),
      ciphertext: hex(dke.ciphertext),
      tag: hex(dke.tag),
    },
    {
      id: "TV-DKE-CREDENTIAL-SWAP",
      purpose: "Same DWK, credential_id swapped in AAD → credential substitution must fail",
      expect: "auth_fail",
      key: hex(dwk),
      nonce: "0102030405060708090a0b0c",
      aad: hex(
        deviceKeyAad({
          vaultId: C.vault_id,
          deviceId: C.device_id,
          credentialId: fromHex("0badc0de0badc0de0badc0de0badc0de"),
          cryptoVersion: C.crypto_version,
          deviceKeyVersion: C.device_key_version,
        }),
      ),
      ciphertext: hex(dke.ciphertext),
      tag: hex(dke.tag),
    },
    {
      id: "TV-DKE-VERSION-ROLLBACK",
      purpose: "Same DWK, deviceKeyVersion rolled back in AAD → must fail",
      expect: "auth_fail",
      key: hex(dwk),
      nonce: "0102030405060708090a0b0c",
      aad: hex(
        deviceKeyAad({
          vaultId: C.vault_id,
          deviceId: C.device_id,
          credentialId: fromHex(C.credential_id),
          cryptoVersion: C.crypto_version,
          deviceKeyVersion: C.device_key_version - 1,
        }),
      ),
      ciphertext: hex(dke.ciphertext),
      tag: hex(dke.tag),
    },
  ],
};

for (const v of deviceSuite.negative) {
  if (v.expect !== "auth_fail") continue;
  if (decrypts(fromHex(v.key), fromHex(v.nonce), fromHex(v.ciphertext), fromHex(v.tag), fromHex(v.aad))) {
    throw new Error(`${v.id} unexpectedly decrypts`);
  }
}

// ---------------------------------------------------------------- recovery-v1

const rwkSaltPreimage = encodeAad([L.rwkSalt, C.vault_id]);
const rwkInfo = encodeAad([L.rwkInfo, C.vault_id, u32be(C.crypto_version)]);
const rwk = Buffer.from(hkdfSync("sha256", fromHex(C.recovery_key), sha256(rwkSaltPreimage), rwkInfo, 32));
const recoveryChecksum = sha256(frame([L.recoveryChecksum, fromHex(C.recovery_key)])).subarray(0, 2);
const kitEncoded = base32Encode(Buffer.concat([fromHex(C.recovery_key), recoveryChecksum]));
const kitGrouped = (kitEncoded.match(/.{1,5}/g) ?? []).join("-");
const recoveryEnvelopeAad = envelopeAad({
  vaultId: C.vault_id,
  type: "recovery",
  cryptoVersion: C.crypto_version,
  vaultKeyVersion: C.vault_key_version,
  deviceId: "",
  deviceKeyVersion: 0,
});
const recoveryEnvelope = encrypt(
  rwk,
  fromHex("333333333333333333333333"),
  fromHex(C.vault_key),
  recoveryEnvelopeAad,
);

const recoverySuite = {
  protocol: "4AllPass Crypto Protocol v1",
  primitive: "Recovery Key → HKDF-SHA-256 → Recovery Wrapping Key → AES-256-GCM",
  generated: aesSuite.generated,
  generator: aesSuite.generator,
  verified_with: ["node:crypto hkdfSync/sha256", "@noble/hashes hkdf via packages/crypto tests"],
  constants: {
    vault_id: C.vault_id,
    crypto_version: C.crypto_version,
    vault_key_version: C.vault_key_version,
    vault_key: C.vault_key,
    recovery_key: C.recovery_key,
  },
  encoding: {
    alphabet: ALPHABET,
    scheme: "Crockford Base32 of (recovery_key || checksum), groups of 5 joined with '-'",
    checksum_bytes: 2,
    checksum_fields: [L.recoveryChecksum, "recovery_key"],
    substitutions: { O: "0", I: "1", L: "1" },
  },
  success: [
    {
      id: "TV-RK-FORMAT",
      purpose: "Emergency-Kit representation of a 256-bit Recovery Key",
      recovery_key: C.recovery_key,
      checksum: hex(recoveryChecksum),
      encoded: kitEncoded,
      formatted: kitGrouped,
    },
    {
      id: "TV-RWK-01",
      purpose: "HKDF-SHA-256 Recovery Wrapping Key, bound to the vault",
      hkdf_salt_preimage: hex(rwkSaltPreimage),
      hkdf_info: hex(rwkInfo),
      recovery_wrapping_key: hex(rwk),
    },
    {
      id: "TV-ENV-RECOVERY-RWK",
      purpose: "Recovery envelope: VK wrapped under RWK (not under the printed key)",
      expect: "decrypt_ok",
      key: hex(rwk),
      nonce: "333333333333333333333333",
      aad: hex(recoveryEnvelopeAad),
      plaintext: C.vault_key,
      ciphertext: hex(recoveryEnvelope.ciphertext),
      tag: hex(recoveryEnvelope.tag),
    },
  ],
  negative: [
    {
      id: "TV-RK-CHECKSUM",
      purpose: "One mistyped character must be reported as a checksum failure, not as a wrong key",
      formatted: `${kitGrouped.slice(0, 2)}${kitGrouped[2] === "0" ? "1" : "0"}${kitGrouped.slice(3)}`,
      expect: "checksum_fail",
    },
    {
      id: "TV-RK-NONCANONICAL",
      purpose: "The padding bits of the last character must be zero",
      formatted: `${kitGrouped.slice(0, -1)}${kitGrouped.at(-1) === "1" ? "2" : "1"}`,
      expect: "parse_fail",
    },
    {
      id: "TV-RWK-WRONG-VAULT",
      purpose: "The same Recovery Key must derive a different RWK for another vault",
      vault_id: "vault_OTHER",
      expect: "rwk_differs",
      differs_from: "TV-RWK-01",
    },
  ],
};

// ---------------------------------------------------------------- write files

function write(name, data) {
  const path = join(vectorDir, name);
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  })();
  if (previous) {
    // Keep the recorded generation timestamp stable when nothing else changed.
    const a = JSON.stringify({ ...previous, generated: null });
    const b = JSON.stringify({ ...data, generated: null });
    if (a === b) {
      console.log(`  unchanged  ${name}`);
      return;
    }
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  wrote      ${name}`);
}

write("aes-gcm-v1.json", aesSuite);
write("device-prf-v1.json", deviceSuite);
write("recovery-v1.json", recoverySuite);

/**
 * argon2id-v1.json keeps its Argon2 known-answer values (they come from the
 * reference C library via scripts/verify-argon2id-vectors.py); only the master
 * envelope wrap that sits on top of them is recomputed, because the envelope
 * AAD now covers vault_key_version and the KDF parameter digest.
 */
{
  const path = join(vectorDir, "argon2id-v1.json");
  const argon = JSON.parse(readFileSync(path, "utf8"));
  const wrapAad = envelopeAad({
    vaultId: C.vault_id,
    type: "master",
    cryptoVersion: C.crypto_version,
    vaultKeyVersion: C.vault_key_version,
    deviceId: "",
    deviceKeyVersion: 0,
    kdf: KDF,
  });
  const sealed = encrypt(
    fromHex(argon.wrap[0].key),
    fromHex(argon.wrap[0].nonce),
    fromHex(C.vault_key),
    wrapAad,
  );
  argon.wrap[0] = {
    ...argon.wrap[0],
    aad: hex(wrapAad),
    vault_key_version: C.vault_key_version,
    kdf_params_digest: hex(kdfParamsDigest(KDF)),
    plaintext: C.vault_key,
    ciphertext: hex(sealed.ciphertext),
    tag: hex(sealed.tag),
  };
  argon.wrap[1] = {
    ...argon.wrap[1],
    aad: hex(wrapAad),
    vault_key_version: C.vault_key_version,
    ciphertext: hex(sealed.ciphertext),
    tag: hex(sealed.tag),
  };
  if (
    decrypts(
      fromHex(argon.wrap[1].key),
      fromHex(argon.wrap[1].nonce),
      fromHex(argon.wrap[1].ciphertext),
      fromHex(argon.wrap[1].tag),
      fromHex(argon.wrap[1].aad),
    )
  ) {
    throw new Error("TV-ARGON2-WRAP-WRONGPW unexpectedly decrypts");
  }
  write("argon2id-v1.json", argon);
}

if (process.argv.includes("--print-markdown")) {
  console.log("\n--- docs/test-vectors.md AAD table ---");
  for (const [name, value] of Object.entries(aesSuite.aad_construction.hex)) {
    console.log(`| ${name} | \`${value}\` |`);
  }
  console.log(`| device_key (device-prf-v1.json) | \`${deviceSuite.aad_construction.hex.device_key}\` |`);
  console.log("\n--- ciphertext / tag ---");
  for (const v of aesSuite.success) {
    console.log(`${v.id}\n  nonce      ${v.nonce}\n  ciphertext ${v.ciphertext}\n  tag        ${v.tag}`);
  }
  console.log(`\nkdf_params_digest ${aesSuite.constants.kdf_params_digest}`);
  console.log(`manifest body     ${aesSuite.manifest.body}`);
  console.log(`manifest sha256   ${aesSuite.manifest.body_sha256}`);
  console.log(`\nDWK               ${deviceSuite.success[1].device_wrapping_key}`);
  console.log(`DKE ciphertext    ${deviceSuite.success[2].ciphertext}`);
  console.log(`DKE tag           ${deviceSuite.success[2].tag}`);
  console.log(`\nRWK               ${recoverySuite.success[1].recovery_wrapping_key}`);
  console.log(`Kit               ${recoverySuite.success[0].formatted}`);
  console.log(`Recovery env ct   ${recoverySuite.success[2].ciphertext}`);
  console.log(`Recovery env tag  ${recoverySuite.success[2].tag}`);
}
