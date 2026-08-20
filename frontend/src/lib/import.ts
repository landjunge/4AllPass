import { newEntryId, type VaultEntry } from "./entries.ts";

export type ImportFormat = "bitwarden-json" | "csv";

export interface ImportResult {
  format: ImportFormat;
  entries: VaultEntry[];
  skipped: number;
}

const PLAINTEXT_WARNING =
  "This file is plaintext. After you confirm, 4AllPass encrypts the entries on this device and the server only stores ciphertext. Delete the export file.";

export function plaintextImportWarning(): string {
  return PLAINTEXT_WARNING;
}

function asEntry(partial: {
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
}): VaultEntry {
  return {
    id: newEntryId(),
    title: partial.title?.trim() ?? "",
    username: partial.username?.trim() ?? "",
    password: partial.password ?? "",
    url: partial.url?.trim() ?? "",
    notes: partial.notes?.trim() ?? "",
    updatedAt: new Date().toISOString(),
  };
}

function parseCsv(text: string): ImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return { format: "csv", entries: [], skipped: 0 };
  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const col = (names: string[]): number => header.findIndex((h) => names.includes(h));
  const title = col(["title", "name", "account", "entry"]);
  const username = col(["username", "user", "login name", "login", "email"]);
  const password = col(["password", "pass"]);
  const url = col(["url", "uri", "website", "web site", "login_uri"]);
  const notes = col(["notes", "note", "comments", "comment"]);
  if (title < 0 && username < 0 && password < 0) {
    throw new Error("CSV needs a Title, Username, or Password column");
  }
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const entry = asEntry({
      title: title >= 0 ? cells[title] ?? "" : "",
      username: username >= 0 ? cells[username] ?? "" : "",
      password: password >= 0 ? cells[password] ?? "" : "",
      url: url >= 0 ? cells[url] ?? "" : "",
      notes: notes >= 0 ? cells[notes] ?? "" : "",
    });
    if (!entry.title && !entry.username && !entry.password) {
      skipped += 1;
      continue;
    }
    entries.push(entry);
  }
  return { format: "csv", entries, skipped };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

function parseBitwarden(data: unknown): ImportResult | null {
  if (!data || typeof data !== "object" || !("items" in data)) return null;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return null;
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const row = item as {
      type?: number;
      name?: string;
      notes?: string;
      login?: { username?: string; password?: string; uris?: Array<{ uri?: string }> };
    };
    if (row.type !== 1 || !row.login) {
      skipped += 1;
      continue;
    }
    entries.push(
      asEntry({
        title: row.name ?? "",
        username: row.login.username ?? "",
        password: row.login.password ?? "",
        url: row.login.uris?.[0]?.uri ?? "",
        notes: row.notes ?? "",
      }),
    );
  }
  return { format: "bitwarden-json", entries, skipped };
}

/** Parse a Bitwarden JSON export or a Title/Username/Password CSV (KeePass / 1Password-style). */
export function parsePlaintextExport(text: string): ImportResult {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const bitwarden = parseBitwarden(parsed);
    if (bitwarden) return bitwarden;
    throw new Error("JSON is not a Bitwarden item export");
  }
  return parseCsv(trimmed);
}
