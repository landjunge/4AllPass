export type EnvelopeType = "master" | "device" | "recovery";

export type Argon2idProfileName =
  | "ci"
  | "mobile_safe"
  | "balanced"
  | "standard"
  | "high";

export interface Argon2idParams {
  algorithm: "argon2id";
  version: 0x13;
  memory: number;
  iterations: number;
  parallelism: number;
  hashLen: 32;
}

export interface Argon2idProfile extends Argon2idParams {
  name: Argon2idProfileName;
  production: boolean;
}

export interface KdfParams extends Argon2idParams {
  salt: Uint8Array;
}

/**
 * Every field of a KeyEnvelope is authenticated: the AAD covers `type`,
 * `vaultKeyVersion`, `deviceId`, `deviceKeyVersion` and a digest of `kdf`.
 * Numeric fields are typed as `number` (not literals) because they arrive from
 * the server as JSON and are validated at runtime, never trusted by type.
 */
export interface KeyEnvelope {
  version: number;
  type: EnvelopeType;
  /** Which Vault-Key generation this envelope wraps. */
  vaultKeyVersion: number;
  /** Present only when `type === "master"`. */
  kdf?: KdfParams;
  /** Present only when `type === "device"`. */
  deviceId?: string;
  /** Present only when `type === "device"`: which Device-Key generation wraps it. */
  deviceKeyVersion?: number;
  encryption: "AES-256-GCM";
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface EncryptedEntry {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  /** Which Vault-Key generation sealed this entry. */
  vaultKeyVersion: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface DeviceKeyEnvelope {
  version: number;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  /** Device-Key generation, incremented when the local Device Key is rotated. */
  deviceKeyVersion: number;
  encryption: "AES-256-GCM";
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface VaultRevision {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
  /**
   * Digest of the sealed manifest that was cryptographically verified for this
   * revision. Pinning it turns "same revision" into an equivocation check.
   */
  manifestDigest?: Uint8Array;
}

export interface ManifestEntryRef {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  vaultKeyVersion: number;
  digest: Uint8Array;
}

export interface ManifestEnvelopeRef {
  type: EnvelopeType;
  /** Empty string for master / recovery envelopes. */
  deviceId: string;
  vaultKeyVersion: number;
  /** 0 for master / recovery envelopes. */
  deviceKeyVersion: number;
  digest: Uint8Array;
}

/**
 * The authenticated description of one immutable vault snapshot. Sealing it
 * under the Vault Key is what binds `revision` to actual bytes: a server can
 * still lie about the revision number, but it cannot produce a manifest for it.
 */
export interface SnapshotManifest {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
  entries: ManifestEntryRef[];
  envelopes: ManifestEnvelopeRef[];
}

export interface SealedManifest {
  version: number;
  encryption: "AES-256-GCM";
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface GcmBox {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export type AadField = string | Uint8Array;
