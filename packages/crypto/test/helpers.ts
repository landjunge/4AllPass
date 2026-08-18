import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hexToBytes } from "../src/encoding/bytes.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..", "..");
export const VECTORS = join(REPO_ROOT, "docs", "test-vectors");

export function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTORS, name), "utf8")) as T;
}

export const hex = hexToBytes;

export function skipHeavy(memoryKib: number): boolean {
  return process.env.RUN_HEAVY !== "1" && memoryKib > 256;
}

export interface GcmVector {
  id: string;
  expect: "decrypt_ok" | "auth_fail";
  key: string;
  nonce: string;
  aad: string;
  plaintext?: string;
  ciphertext: string;
  tag: string;
  notes?: { plaintext_utf8?: string; envelope_type?: string } | null;
}

export interface AesSuite {
  constants: {
    vault_id: string;
    entry_id: string;
    device_id: string;
    crypto_version: number;
    schema_version: number;
    vault_key_version: number;
    device_key_version: number;
    revision: number;
    vault_key: string;
    master_key: string;
    device_key: string;
    recovery_key: string;
    kdf: {
      algorithm: "argon2id";
      version: number;
      memory_kib: number;
      iterations: number;
      parallelism: number;
      hash_len: number;
      salt: string;
    };
    kdf_params_digest: string;
  };
  aad_construction: { hex: Record<string, string> };
  manifest: {
    revision: number;
    vault_key_version: number;
    entries: Array<{ id: string; digest: string }>;
    envelopes: Array<{ type: string; device_id: string; device_key_version: number; digest: string }>;
    body: string;
    body_sha256: string;
  };
  success: GcmVector[];
  tamper: GcmVector[];
  nist: GcmVector[];
}

export interface DeviceSuite {
  constants: {
    vault_id: string;
    device_id: string;
    rp_id: string;
    credential_id: string;
    prf_output: string;
    device_key: string;
    crypto_version: number;
    device_key_version: number;
  };
  aad_construction: { hex: Record<string, string> };
  success: Array<Record<string, string>>;
  negative: Array<Record<string, string>>;
}

export interface RecoverySuite {
  constants: {
    vault_id: string;
    crypto_version: number;
    vault_key_version: number;
    vault_key: string;
    recovery_key: string;
  };
  encoding: { alphabet: string; checksum_bytes: number };
  success: Array<Record<string, string>>;
  negative: Array<Record<string, string>>;
}

export interface Argon2Vector {
  id: string;
  expect: string;
  password: string;
  salt: string;
  secret?: string;
  associated_data?: string;
  memory_kib: number;
  iterations: number;
  parallelism: number;
  hash_len: number;
  version: number;
  dk: string;
  profile?: string;
}
