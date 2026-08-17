import { sha256 } from "@noble/hashes/sha2.js";
import {
  ENTRY_DIGEST_LABEL,
  ENVELOPE_DIGEST_LABEL,
  KDF_PARAMS_LABEL,
  SEALED_MANIFEST_DIGEST_LABEL,
} from "../constants.ts";
import type { EncryptedEntry, KdfParams, KeyEnvelope, SealedManifest } from "../types.ts";
import { frame } from "./framing.ts";

/**
 * Canonical digest of the Argon2id parameters of a master envelope.
 * The digest goes into the envelope AAD, so parameters cannot be swapped
 * (weakened, or pointed at a different salt) without breaking the GCM tag.
 */
export function kdfParamsDigest(kdf: KdfParams): Uint8Array {
  return sha256(
    frame([
      KDF_PARAMS_LABEL,
      kdf.algorithm,
      kdf.version,
      kdf.memory,
      kdf.iterations,
      kdf.parallelism,
      kdf.hashLen,
      kdf.salt,
    ]),
  );
}

/** Digest over the complete sealed entry, used by the snapshot manifest. */
export function entryDigest(entry: EncryptedEntry): Uint8Array {
  return sha256(
    frame([
      ENTRY_DIGEST_LABEL,
      entry.id,
      entry.schemaVersion,
      entry.cryptoVersion,
      entry.vaultKeyVersion,
      entry.nonce,
      entry.ciphertext,
      entry.tag,
    ]),
  );
}

/** Digest over the complete key envelope, used by the snapshot manifest. */
export function envelopeDigest(envelope: KeyEnvelope): Uint8Array {
  return sha256(
    frame([
      ENVELOPE_DIGEST_LABEL,
      envelope.type,
      envelope.deviceId ?? "",
      envelope.version,
      envelope.vaultKeyVersion,
      envelope.deviceKeyVersion ?? 0,
      envelope.kdf ? kdfParamsDigest(envelope.kdf) : new Uint8Array(0),
      envelope.nonce,
      envelope.ciphertext,
      envelope.tag,
    ]),
  );
}

/** Stable identifier of a sealed manifest, suitable for pinning across restarts. */
export function sealedManifestDigest(sealed: SealedManifest): Uint8Array {
  return sha256(
    frame([
      SEALED_MANIFEST_DIGEST_LABEL,
      sealed.version,
      sealed.nonce,
      sealed.ciphertext,
      sealed.tag,
    ]),
  );
}
