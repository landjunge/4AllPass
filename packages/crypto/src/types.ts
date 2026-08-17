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
  version: number;
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
