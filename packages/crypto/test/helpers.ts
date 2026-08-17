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
