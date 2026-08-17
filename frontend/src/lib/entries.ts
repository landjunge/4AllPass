/** Plaintext entry schema. Only ever exists on the client after unlock. */
import { bytesToHex, randomBytes } from "@4allpass/crypto";

export const ENTRY_SCHEMA_VERSION = 1;

export interface VaultEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  updatedAt: string;
}

export type EntryDraft = Omit<VaultEntry, "id" | "updatedAt">;

export function newEntryId(): string {
  return `entry_${bytesToHex(randomBytes(12))}`;
}

export function emptyDraft(): EntryDraft {
  return { title: "", username: "", password: "", url: "", notes: "" };
}

export function encodeEntryPlaintext(entry: VaultEntry): Uint8Array {
  const payload = {
    title: entry.title,
    username: entry.username,
    password: entry.password,
    url: entry.url,
    notes: entry.notes,
    updatedAt: entry.updatedAt,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodeEntryPlaintext(id: string, plaintext: Uint8Array): VaultEntry {
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultEntry>;
  return {
    id,
    title: parsed.title ?? "",
    username: parsed.username ?? "",
    password: parsed.password ?? "",
    url: parsed.url ?? "",
    notes: parsed.notes ?? "",
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

export function generatePassword(length = 24): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";
  const bytes = randomBytes(length * 2);
  let out = "";
  for (const byte of bytes) {
    if (out.length === length) break;
    // Rejection sampling keeps the distribution uniform.
    if (byte < Math.floor(256 / alphabet.length) * alphabet.length) {
      out += alphabet[byte % alphabet.length];
    }
  }
  return out.length === length ? out : generatePassword(length);
}
