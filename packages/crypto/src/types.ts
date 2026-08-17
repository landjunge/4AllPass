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

export interface KeyEnvelope {
  version: 1;
  type: EnvelopeType;
  kdf?: KdfParams;
  deviceId?: string;
  encryption: "AES-256-GCM";
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface EncryptedEntry {
  id: string;
  schemaVersion: number;
  cryptoVersion: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface DeviceKeyEnvelope {
  version: 1;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  /** Monotonic Device-Key generation. +1 only when this device's DK is rotated. */
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
  cryptoProtocolVersion: 1;
}

/** Cleartext header of a sealed snapshot manifest. Numbers are untrusted until AEAD succeeds. */
export interface SealedManifest {
  version: 1;
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: 1;
  encryption: "AES-256-GCM";
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface ManifestEnvelopeCommitment {
  type: EnvelopeType;
  deviceId: string;
  digest: Uint8Array;
}

export interface ManifestEntryCommitment {
  id: string;
  digest: Uint8Array;
}

/** Authenticated snapshot contents after `openManifest`. */
export interface VaultManifest {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: 1;
  envelopes: ManifestEnvelopeCommitment[];
  entries: ManifestEntryCommitment[];
}

export interface GcmBox {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export type AadField = string | Uint8Array;
