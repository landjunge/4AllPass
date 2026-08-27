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
  credentialType: string;
  notes: string;
  /** Base32 TOTP secret. Empty if unused. Encrypted with the entry. */
  totpSecret: string;
  updatedAt: string;
  /** Normalized host from the login URL. Never inferred as trust. */
  domain: string;
  providerId: string;
  providerConfidence: number;
  providerMatchType: string;
  /** Client UI flag. Encrypted with the entry; not a separate store. */
  favorite: boolean;
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
    credentialType: kind === "api" ? "api_key" : "password",
    notes: "",
    totpSecret: "",
    domain: "",
    providerId: "",
    providerConfidence: 0,
    providerMatchType: "",
    favorite: false,
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
    credentialType: entry.credentialType,
    notes: entry.notes,
    totpSecret: entry.totpSecret,
    updatedAt: entry.updatedAt,
    domain: entry.domain,
    providerId: entry.providerId,
    providerConfidence: entry.providerConfidence,
    providerMatchType: entry.providerMatchType,
    favorite: entry.favorite,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Clear every secret class on an unlocked entry. Call from `lock()`.
 * Username/title stay; they are not vault secrets.
 */
export function wipeVaultEntry(entry: VaultEntry): void {
  entry.password = "";
  entry.notes = "";
  entry.totpSecret = "";
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
    credentialType: parsed.credentialType ?? "",
    notes: parsed.notes ?? "",
    totpSecret: typeof parsed.totpSecret === "string" ? parsed.totpSecret : "",
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    domain: parsed.domain ?? "",
    providerId: parsed.providerId ?? "",
    providerConfidence: parsed.providerConfidence ?? 0,
    providerMatchType: parsed.providerMatchType ?? "",
    favorite: parsed.favorite === true,
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
