import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES, NONCE_BYTES, TAG_BYTES } from "./constants.ts";
import { envelopeAad } from "./encoding/aad.ts";
import { ProtocolError } from "./errors.ts";
import { decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { assertKdfBlock } from "./kdf/profiles.ts";
import {
  assertBytes,
  assertId,
  assertVersion,
  requireSameNumber,
  requireSameString,
} from "./validate.ts";
import type { EnvelopeType, GcmBox, KdfParams, KeyEnvelope } from "./types.ts";

const ENVELOPE_TYPES: readonly EnvelopeType[] = ["master", "device", "recovery"];

export interface WrapVaultKeyOptions {
  vaultKey: Uint8Array;
  wrappingKey: Uint8Array;
  vaultId: string;
  type: EnvelopeType;
  /** Which Vault-Key generation is being wrapped. Never defaulted. */
  vaultKeyVersion: number;
  /** Required for `type === "device"`, forbidden otherwise. */
  deviceId?: string;
  /** Required for `type === "device"`, forbidden otherwise. */
  deviceKeyVersion?: number;
  /** Required for `type === "master"`, forbidden otherwise. */
  kdf?: KdfParams;
  /** Allow the test-only `ci` profile when creating a master envelope. */
  allowTestProfile?: boolean;
  cryptoVersion?: number;
}

export interface UnwrapVaultKeyOptions {
  wrappingKey: Uint8Array;
  vaultId: string;
  /** The envelope kind the caller intends to open. A `recovery` blob served in
   * place of the `master` blob is an attack, not a variation. */
  expectType: EnvelopeType;
  /** The Vault-Key generation of the snapshot being opened. */
  expectVaultKeyVersion: number;
  /** Required when `expectType === "device"`. */
  expectDeviceId?: string;
  /** Required when `expectType === "device"`: the local Device-Key generation. */
  expectDeviceKeyVersion?: number;
  /** Accept a `ci`-profile master envelope (tests only). */
  allowTestProfile?: boolean;
}

interface ResolvedEnvelopeFields {
  vaultId: string;
  type: EnvelopeType;
  cryptoVersion: number;
  vaultKeyVersion: number;
  deviceId: string;
  deviceKeyVersion: number;
  kdf: KdfParams | undefined;
}

function assertEnvelopeType(value: unknown): EnvelopeType {
  if (typeof value !== "string" || !ENVELOPE_TYPES.includes(value as EnvelopeType)) {
    throw new ProtocolError(`unsupported envelope type: ${String(value)}`);
  }
  return value as EnvelopeType;
}

/**
 * Shape rules per envelope kind, enforced identically on write and on read.
 * Metadata that does not belong to a kind is rejected rather than ignored:
 * an ignored field is an unauthenticated field an attacker can play with.
 */
function resolveFields(
  input: {
    vaultId: unknown;
    type: unknown;
    cryptoVersion: unknown;
    vaultKeyVersion: unknown;
    deviceId: unknown;
    deviceKeyVersion: unknown;
    kdf: KdfParams | undefined;
  },
  allowTestProfile: boolean,
): ResolvedEnvelopeFields {
  const type = assertEnvelopeType(input.type);
  const vaultId = assertId("vaultId", input.vaultId);
  const cryptoVersion = assertVersion("cryptoVersion", input.cryptoVersion);
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported envelope version: ${cryptoVersion}`);
  }
  const vaultKeyVersion = assertVersion("vaultKeyVersion", input.vaultKeyVersion);

  let deviceId = "";
  let deviceKeyVersion = 0;
  if (type === "device") {
    deviceId = assertId("deviceId", input.deviceId);
    deviceKeyVersion = assertVersion("deviceKeyVersion", input.deviceKeyVersion);
  } else {
    if (input.deviceId !== undefined && input.deviceId !== "") {
      throw new ProtocolError(`${type} envelope must not carry deviceId`);
    }
    if (input.deviceKeyVersion !== undefined) {
      throw new ProtocolError(`${type} envelope must not carry deviceKeyVersion`);
    }
  }

  if (type === "master") {
    if (!input.kdf) throw new ProtocolError("master envelope requires kdf parameters");
    assertKdfBlock(input.kdf, allowTestProfile);
  } else if (input.kdf) {
    throw new ProtocolError(`${type} envelope must not carry kdf parameters`);
  }

  return { vaultId, type, cryptoVersion, vaultKeyVersion, deviceId, deviceKeyVersion, kdf: input.kdf };
}

function prepareWrap(opts: WrapVaultKeyOptions): { fields: ResolvedEnvelopeFields; aad: Uint8Array } {
  assertBytes("vaultKey", opts.vaultKey, { exact: KEY_BYTES });
  assertBytes("wrappingKey", opts.wrappingKey, { exact: KEY_BYTES });
  const fields = resolveFields(
    {
      vaultId: opts.vaultId,
      type: opts.type,
      cryptoVersion: opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION,
      vaultKeyVersion: opts.vaultKeyVersion,
      deviceId: opts.deviceId,
      deviceKeyVersion: opts.deviceKeyVersion,
      kdf: opts.kdf,
    },
    opts.allowTestProfile === true,
  );
  return { fields, aad: envelopeAad(fields) };
}

function buildEnvelope(fields: ResolvedEnvelopeFields, box: GcmBox): KeyEnvelope {
  const envelope: KeyEnvelope = {
    version: fields.cryptoVersion,
    type: fields.type,
    vaultKeyVersion: fields.vaultKeyVersion,
    encryption: "AES-256-GCM",
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    tag: box.tag,
  };
  if (fields.kdf) envelope.kdf = fields.kdf;
  if (fields.type === "device") {
    envelope.deviceId = fields.deviceId;
    envelope.deviceKeyVersion = fields.deviceKeyVersion;
  }
  return envelope;
}

export function wrapVaultKey(opts: WrapVaultKeyOptions): KeyEnvelope {
  const { fields, aad } = prepareWrap(opts);
  return buildEnvelope(fields, encrypt(opts.wrappingKey, opts.vaultKey, aad));
}

/** Test-only wrap with a fixed nonce. */
export function wrapVaultKeyWithNonce(
  opts: WrapVaultKeyOptions & { nonce: Uint8Array },
): KeyEnvelope {
  const { fields, aad } = prepareWrap(opts);
  return buildEnvelope(fields, encryptWithNonce(opts.wrappingKey, opts.nonce, opts.vaultKey, aad));
}

/**
 * Open an envelope against explicit expectations.
 *
 * The AAD is built from the envelope's own fields, so the tag alone proves only
 * "these fields were sealed together" — not "these are the fields I asked for".
 * The `expect*` options close that gap: they are compared before decryption and
 * turn envelope substitution (wrong vault, wrong device, older key generation)
 * into an `IntegrityError` instead of a silent success.
 */
export function unwrapVaultKey(envelope: KeyEnvelope, opts: UnwrapVaultKeyOptions): Uint8Array {
  if (envelope === null || typeof envelope !== "object") {
    throw new ProtocolError("envelope must be an object");
  }
  if (envelope.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported envelope encryption: ${String(envelope.encryption)}`);
  }
  assertBytes("wrappingKey", opts.wrappingKey, { exact: KEY_BYTES });
  assertBytes("envelope.nonce", envelope.nonce, { exact: NONCE_BYTES });
  assertBytes("envelope.ciphertext", envelope.ciphertext, { exact: KEY_BYTES });
  assertBytes("envelope.tag", envelope.tag, { exact: TAG_BYTES });

  const fields = resolveFields(
    {
      vaultId: opts.vaultId,
      type: envelope.type,
      cryptoVersion: envelope.version,
      vaultKeyVersion: envelope.vaultKeyVersion,
      deviceId: envelope.deviceId,
      deviceKeyVersion: envelope.deviceKeyVersion,
      kdf: envelope.kdf,
    },
    opts.allowTestProfile === true,
  );

  requireSameString("envelope.type", assertEnvelopeType(opts.expectType), fields.type);
  requireSameNumber(
    "envelope.vaultKeyVersion",
    assertVersion("expectVaultKeyVersion", opts.expectVaultKeyVersion),
    fields.vaultKeyVersion,
  );
  if (fields.type === "device") {
    requireSameString(
      "envelope.deviceId",
      assertId("expectDeviceId", opts.expectDeviceId),
      fields.deviceId,
    );
    requireSameNumber(
      "envelope.deviceKeyVersion",
      assertVersion("expectDeviceKeyVersion", opts.expectDeviceKeyVersion),
      fields.deviceKeyVersion,
    );
  }

  const vk = decrypt(
    opts.wrappingKey,
    envelope.nonce,
    envelope.ciphertext,
    envelope.tag,
    envelopeAad(fields),
  );
  assertBytes("vaultKey", vk, { exact: KEY_BYTES });
  return vk;
}
