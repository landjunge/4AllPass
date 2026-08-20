/** Plaintext entry schema. Only ever exists on the client after unlock. */
import { bytesToHex, randomBytes } from "@4allpass/crypto";

export const ENTRY_SCHEMA_VERSION = 1;

/** MVP provider classes (8-week plan). More kinds stay in provider-service-vision.md. */
export type EntryKind = "web" | "api" | "sftp";

export interface VaultEntry {
  id: string;
  kind: EntryKind;
  title: string;
  provider: string;
  account: string;
  username: string;
  password: string;
  url: string;
  host: string;
  port: string;
  protocol: string;
  capabilities: string;
  notes: string;
  updatedAt: string;
}

export type EntryDraft = Omit<VaultEntry, "id" | "updatedAt">;

export function newEntryId(): string {
  return `entry_${bytesToHex(randomBytes(12))}`;
}

export function emptyDraft(kind: EntryKind = "web"): EntryDraft {
  return {
    kind,
    title: "",
    provider: kind === "api" ? "GitHub" : kind === "sftp" ? "" : "",
    account: "",
    username: "",
    password: "",
    url: "",
    host: "",
    port: kind === "sftp" ? "22" : "",
    protocol: kind === "sftp" ? "sftp" : "",
    capabilities: kind === "api" ? "repository.read" : "",
    notes: "",
  };
}

function asKind(value: unknown): EntryKind {
  return value === "api" || value === "sftp" || value === "web" ? value : "web";
}

export function encodeEntryPlaintext(entry: VaultEntry): Uint8Array {
  const payload = {
    kind: entry.kind,
    title: entry.title,
    provider: entry.provider,
    account: entry.account,
    username: entry.username,
    password: entry.password,
    url: entry.url,
    host: entry.host,
    port: entry.port,
    protocol: entry.protocol,
    capabilities: entry.capabilities,
    notes: entry.notes,
    updatedAt: entry.updatedAt,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodeEntryPlaintext(id: string, plaintext: Uint8Array): VaultEntry {
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VaultEntry> & {
    kind?: unknown;
  };
  return {
    id,
    kind: asKind(parsed.kind),
    title: parsed.title ?? "",
    provider: parsed.provider ?? "",
    account: parsed.account ?? "",
    username: parsed.username ?? "",
    password: parsed.password ?? "",
    url: parsed.url ?? "",
    host: parsed.host ?? "",
    port: parsed.port ?? "",
    protocol: parsed.protocol ?? "",
    capabilities: parsed.capabilities ?? "",
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
