/**
 * Turn a row from a file or paste into a vault entry.
 * Runs only on the unlocked client. Never logs values.
 */
import { providerById, resolveProvider } from "@4allpass/providers";
import { detectCredential } from "./detect.ts";
import { newEntryId, type VaultEntry } from "./entries.ts";

export interface ImportFields {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  /** Env var or CSV column name. Not a secret. */
  nameHint?: string;
}

const NAMED_API: Array<{
  test: RegExp;
  provider: string;
  providerId: string;
  url: string;
  capabilities: string;
}> = [
  { test: /openai/i, provider: "OpenAI", providerId: "openai", url: "https://api.openai.com", capabilities: "api.read" },
  { test: /github|gh[_-]?token/i, provider: "GitHub", providerId: "github", url: "https://api.github.com", capabilities: "repository.read" },
  { test: /stripe/i, provider: "Stripe", providerId: "stripe", url: "https://api.stripe.com", capabilities: "api.read" },
  { test: /cloudflare|^cf_/i, provider: "Cloudflare", providerId: "cloudflare", url: "https://api.cloudflare.com", capabilities: "api.read" },
];

function nowIso(): string {
  return new Date().toISOString();
}

function namedApi(hint: string): (typeof NAMED_API)[number] | null {
  const text = hint.trim();
  if (!text) return null;
  return NAMED_API.find((row) => row.test.test(text)) ?? null;
}

function apiEntry(
  fields: ImportFields,
  opts: { provider: string; providerId: string; url: string; capabilities: string; password: string },
): VaultEntry {
  const resolved = resolveProvider(opts.url);
  return {
    id: newEntryId(),
    kind: "api",
    title: (fields.title?.trim() || opts.provider).replace(/_/g, " "),
    provider: opts.provider,
    account: "",
    username: fields.username?.trim() ?? "",
    password: opts.password,
    url: fields.url?.trim() || opts.url,
    host: "",
    port: "",
    protocol: "",
    capabilities: opts.capabilities,
    credentialType: "api_key",
    notes: fields.notes?.trim() ?? "",
    totpSecret: "",
    updatedAt: nowIso(),
    domain: resolved.normalizedDomain,
    providerId: opts.providerId,
    providerConfidence: 1,
    providerMatchType: "heuristic",
    favorite: false,
  };
}

export function classifyImportedEntry(fields: ImportFields): VaultEntry {
  const password = fields.password ?? "";
  const hint = fields.nameHint?.trim() ?? "";
  const detected = detectCredential(password);

  if (detected?.kind === "api") {
    const named = namedApi(detected.provider) ?? namedApi(hint);
    return apiEntry(fields, {
      provider: detected.provider,
      providerId: named?.providerId ?? detected.provider.toLowerCase(),
      url: detected.url || named?.url || "",
      capabilities: detected.capabilities,
      password: detected.password || password,
    });
  }

  if (detected?.kind === "sftp") {
    const resolved = resolveProvider(detected.host);
    return {
      id: newEntryId(),
      kind: "sftp",
      title: fields.title?.trim() || detected.title,
      provider: detected.provider,
      account: "",
      username: fields.username?.trim() || detected.username,
      password: detected.password || password,
      url: fields.url?.trim() ?? "",
      host: detected.host,
      port: detected.port,
      protocol: detected.protocol,
      capabilities: detected.capabilities,
      credentialType: "password",
      notes: fields.notes?.trim() ?? "",
      totpSecret: "",
      updatedAt: nowIso(),
      domain: resolved.normalizedDomain,
      providerId: resolved.providerId ?? "",
      providerConfidence: resolved.confidence,
      providerMatchType: resolved.matchType,
      favorite: false,
    };
  }

  const named = namedApi(hint);
  if (named && password.trim().length >= 8) {
    return apiEntry(fields, { ...named, password });
  }

  const url = fields.url?.trim() ?? "";
  const resolved = resolveProvider(url);
  const kinds = resolved.providerId ? (providerById(resolved.providerId)?.credentialKinds ?? []) : [];
  const hasUser = Boolean(fields.username?.trim());
  if (resolved.providerId && kinds.includes("api") && !hasUser && password.trim().length >= 8) {
    const def = providerById(resolved.providerId);
    return apiEntry(fields, {
      provider: def?.name ?? resolved.providerName ?? "API",
      providerId: resolved.providerId,
      url: url || `https://${resolved.normalizedDomain}`,
      capabilities: "api.read",
      password,
    });
  }

  return {
    id: newEntryId(),
    kind: "web",
    title: fields.title?.trim() ?? "",
    provider: resolved.providerName ?? "",
    account: "",
    username: fields.username?.trim() ?? "",
    password,
    url,
    host: "",
    port: "",
    protocol: "",
    capabilities: "",
    credentialType: "password",
    notes: fields.notes?.trim() ?? "",
    totpSecret: "",
    updatedAt: nowIso(),
    domain: resolved.normalizedDomain,
    providerId: resolved.providerId ?? "",
    providerConfidence: resolved.confidence,
    providerMatchType: resolved.matchType,
    favorite: false,
  };
}

export function entryIsUsable(entry: VaultEntry): boolean {
  return Boolean(entry.title || entry.username || entry.password || entry.host);
}

export function parseEnvBindings(text: string): Array<{ name: string; value: string }> {
  const rows: Array<{ name: string; value: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.replace(/^export\s+/, "");
    const eq = body.indexOf("=");
    if (eq < 1) continue;
    const name = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !value) continue;
    rows.push({ name, value });
  }
  return rows;
}

export function looksLikeEnvFile(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) return false;
  if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) return false;
  const hits = lines.filter((line) =>
    /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line.replace(/^export\s+/, "")),
  );
  return hits.length >= 1 && hits.length >= lines.length * 0.6;
}

export function entriesFromEnvText(text: string): VaultEntry[] {
  const entries: VaultEntry[] = [];
  for (const row of parseEnvBindings(text)) {
    const entry = classifyImportedEntry({
      title: row.name,
      password: row.value,
      nameHint: row.name,
    });
    if (entry.kind === "api" && entryIsUsable(entry)) entries.push(entry);
  }
  return entries;
}

export function entriesFromProviderJson(data: unknown): VaultEntry[] | null {
  if (Array.isArray(data)) {
    const entries: VaultEntry[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = [row.provider, row.name, row.id].find((value) => typeof value === "string" && value.trim());
      const secret = [row.token, row.key, row.secret, row.password].find(
        (value) => typeof value === "string" && value.trim(),
      );
      if (typeof secret !== "string") continue;
      const hint = typeof name === "string" ? name : "";
      const entry = classifyImportedEntry({
        title: hint,
        password: secret,
        nameHint: hint,
        url: typeof row.url === "string" ? row.url : "",
      });
      if (entryIsUsable(entry)) entries.push(entry);
    }
    return entries.length > 0 ? entries : null;
  }
  if (!data || typeof data !== "object") return null;
  if ("items" in data || "accounts" in data || "vaults" in data) return null;
  const obj = data as Record<string, unknown>;
  const values = Object.values(obj);
  if (values.some((value) => value !== null && typeof value === "object")) return null;
  const pairs = Object.entries(obj).filter(([, value]) => typeof value === "string" && value.trim());
  if (pairs.length === 0) return null;
  const entries: VaultEntry[] = [];
  for (const [name, value] of pairs) {
    const entry = classifyImportedEntry({
      title: name,
      password: String(value),
      nameHint: name,
    });
    if (entry.kind === "api" && entryIsUsable(entry)) entries.push(entry);
  }
  return entries.length > 0 ? entries : null;
}
