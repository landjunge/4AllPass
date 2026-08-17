import { CRYPTO_PROTOCOL_VERSION, KEY_BYTES } from "./constants.ts";
import { envelopeAad } from "./encoding/aad.ts";
import { assertLength } from "./encoding/bytes.ts";
import { ProtocolError } from "./errors.ts";
import { assertAeadFraming, decrypt, encrypt, encryptWithNonce } from "./aead/aes-gcm.ts";
import { assertProductionKdf } from "./kdf/profiles.ts";
import type { EnvelopeType, KdfParams, KeyEnvelope } from "./types.ts";

export interface WrapVaultKeyOptions {
  vaultKey: Uint8Array;
  wrappingKey: Uint8Array;
  vaultId: string;
  type: EnvelopeType;
  deviceId?: string;
  kdf?: KdfParams;
  /** Allow the test-only `ci` profile when creating a master envelope. */
  allowTestProfile?: boolean;
  cryptoVersion?: number;
}

function requireDeviceId(type: EnvelopeType, deviceId: string | undefined): string {
  if (type === "device") {
    if (!deviceId) throw new ProtocolError("device envelope requires deviceId");
    return deviceId;
  }
  return "";
}

function validateMasterKdf(type: EnvelopeType, kdf: KdfParams | undefined, allowTest: boolean): void {
  if (type === "master") {
    if (!kdf) throw new ProtocolError("master envelope requires kdf parameters");
    if (!allowTest) assertProductionKdf(kdf);
    return;
  }
  if (kdf) throw new ProtocolError(`${type} envelope must not carry kdf parameters`);
}

function resolveCryptoVersion(opts: WrapVaultKeyOptions): number {
  return opts.cryptoVersion ?? CRYPTO_PROTOCOL_VERSION;
}

export function wrapVaultKey(opts: WrapVaultKeyOptions): KeyEnvelope {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  assertLength("wrappingKey", opts.wrappingKey, KEY_BYTES);
  const deviceId = requireDeviceId(opts.type, opts.deviceId);
  validateMasterKdf(opts.type, opts.kdf, opts.allowTestProfile === true);
  const cryptoVersion = resolveCryptoVersion(opts);
  const aad = envelopeAad(opts.vaultId, opts.type, deviceId, cryptoVersion);
  const box = encrypt(opts.wrappingKey, opts.vaultKey, aad);
  return buildEnvelope(opts, deviceId, cryptoVersion, box.nonce, box.ciphertext, box.tag);
}

/** Test-only wrap with a fixed nonce. */
export function wrapVaultKeyWithNonce(
  opts: WrapVaultKeyOptions & { nonce: Uint8Array },
): KeyEnvelope {
  assertLength("vaultKey", opts.vaultKey, KEY_BYTES);
  assertLength("wrappingKey", opts.wrappingKey, KEY_BYTES);
  const deviceId = requireDeviceId(opts.type, opts.deviceId);
  validateMasterKdf(opts.type, opts.kdf, opts.allowTestProfile === true);
  const cryptoVersion = resolveCryptoVersion(opts);
  const aad = envelopeAad(opts.vaultId, opts.type, deviceId, cryptoVersion);
  const box = encryptWithNonce(opts.wrappingKey, opts.nonce, opts.vaultKey, aad);
  return buildEnvelope(opts, deviceId, cryptoVersion, box.nonce, box.ciphertext, box.tag);
}

function buildEnvelope(
  opts: WrapVaultKeyOptions,
  deviceId: string,
  cryptoVersion: number,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
): KeyEnvelope {
  if (cryptoVersion !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`this library only writes envelope version ${CRYPTO_PROTOCOL_VERSION}`);
  }
  const envelope: KeyEnvelope = {
    version: CRYPTO_PROTOCOL_VERSION,
    type: opts.type,
    encryption: "AES-256-GCM",
    nonce,
    ciphertext,
    tag,
  };
  if (opts.kdf) envelope.kdf = opts.kdf;
  if (deviceId) envelope.deviceId = deviceId;
  return envelope;
}

export function unwrapVaultKey(
  envelope: KeyEnvelope,
  wrappingKey: Uint8Array,
  vaultId: string,
): Uint8Array {
  if (envelope.version !== CRYPTO_PROTOCOL_VERSION) {
    throw new ProtocolError(`unsupported envelope version: ${envelope.version}`);
  }
  if (envelope.encryption !== "AES-256-GCM") {
    throw new ProtocolError(`unsupported envelope encryption: ${envelope.encryption}`);
  }
  assertLength("wrappingKey", wrappingKey, KEY_BYTES);
  const deviceId = envelope.type === "device" ? (envelope.deviceId ?? "") : "";
  if (envelope.type === "device" && !deviceId) {
    throw new ProtocolError("device envelope is missing deviceId");
  }
  assertAeadFraming(envelope.nonce, envelope.tag);
  const aad = envelopeAad(vaultId, envelope.type, deviceId, envelope.version);
  const vk = decrypt(
    wrappingKey,
    envelope.nonce,
    envelope.ciphertext,
    envelope.tag,
    aad,
  );
  assertLength("vaultKey", vk, KEY_BYTES);
  return vk;
}
