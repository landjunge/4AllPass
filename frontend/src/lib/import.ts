import { newEntryId, type VaultEntry } from "./entries.ts";
import { looksLikeSharePackage } from "./share.ts";

export type ImportFormat = "bitwarden-json" | "onepassword-json" | "onepassword-1pif" | "keepass-xml" | "csv";

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
    kind: "web",
    title: partial.title?.trim() ?? "",
    provider: "",
    account: "",
    username: partial.username?.trim() ?? "",
    password: partial.password ?? "",
    url: partial.url?.trim() ?? "",
    host: "",
    port: "",
    protocol: "",
    capabilities: "",
    credentialType: "",
    notes: partial.notes?.trim() ?? "",
    updatedAt: new Date().toISOString(),
  };
}

function usable(entry: VaultEntry): boolean {
  return Boolean(entry.title || entry.username || entry.password);
}

export interface BrowserLoginRow {
  url: string;
  username: string;
  password: string;
  title?: string;
  source?: string;
}

export function entriesFromBrowserLogins(rows: BrowserLoginRow[]): VaultEntry[] {
  return rows
    .map((row) =>
      asEntry({
        title: row.title || row.url,
        username: row.username,
        password: row.password,
        url: row.url,
        notes: row.source ? `browser:${row.source}` : "",
      }),
    )
    .filter(usable);
}

export function importReviewRows(
  entries: VaultEntry[],
): Array<{ id: string; title: string; username: string; url: string }> {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title || entry.url,
    username: entry.username,
    url: entry.url,
  }));
}

export function mergeImportedLogins(existing: VaultEntry[], incoming: VaultEntry[]): VaultEntry[] {
  const keyOf = (entry: VaultEntry): string =>
    `${entry.url.replace(/^https?:\/\//, "").split("/")[0] ?? ""}|${entry.username}`.toLowerCase();
  const byKey = new Map(existing.map((entry) => [keyOf(entry), entry]));
  for (const entry of incoming) {
    const key = keyOf(entry);
    const prev = byKey.get(key);
    if (!prev || (entry.password && entry.password !== prev.password)) {
      byKey.set(key, prev ? { ...prev, password: entry.password, updatedAt: entry.updatedAt } : entry);
    }
  }
  return [...byKey.values()];
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
    if (!usable(entry)) {
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
  const looksBitwarden = items.some(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === 1 &&
      (item as { login?: unknown }).login != null,
  );
  if (!looksBitwarden) return null;
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

function fieldValue(
  fields: unknown,
  ids: string[],
): string {
  if (!Array.isArray(fields)) return "";
  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const row = field as { designation?: string; id?: string; name?: string; value?: unknown };
    const key = (row.designation ?? row.id ?? row.name ?? "").toLowerCase();
    if (ids.includes(key) && typeof row.value === "string") return row.value;
  }
  return "";
}

function parse1PasswordItem(item: unknown): VaultEntry | null {
  if (!item || typeof item !== "object") return null;
  const row = item as {
    categoryUuid?: string;
    typeName?: string;
    title?: string;
    state?: string;
    overview?: { title?: string; url?: string; urls?: Array<{ url?: string }> };
    details?: {
      loginFields?: unknown;
      notesPlain?: string;
      password?: string;
      fields?: unknown;
    };
    secureContents?: {
      username?: string;
      password?: string;
      notesPlain?: string;
      fields?: unknown;
      URLs?: Array<{ url?: string }>;
    };
  };
  if (row.state === "archived") return null;
  const typeName = (row.typeName ?? "").toLowerCase();
  const isLogin =
    row.categoryUuid === "001" ||
    typeName.includes("webform") ||
    typeName.includes("login") ||
    Boolean(row.details?.loginFields) ||
    Boolean(row.secureContents?.password) ||
    Boolean(row.overview?.url);
  if (!isLogin && row.categoryUuid && row.categoryUuid !== "001") return null;

  const details = row.details;
  const secure = row.secureContents;
  const username =
    fieldValue(details?.loginFields, ["username"]) ||
    fieldValue(details?.fields, ["username"]) ||
    fieldValue(secure?.fields, ["username"]) ||
    secure?.username ||
    "";
  const password =
    fieldValue(details?.loginFields, ["password"]) ||
    fieldValue(details?.fields, ["password"]) ||
    fieldValue(secure?.fields, ["password"]) ||
    details?.password ||
    secure?.password ||
    "";
  const url =
    row.overview?.url ||
    row.overview?.urls?.[0]?.url ||
    secure?.URLs?.[0]?.url ||
    "";
  const entry = asEntry({
    title: row.overview?.title || row.title || "",
    username,
    password,
    url,
    notes: details?.notesPlain || secure?.notesPlain || "",
  });
  return usable(entry) ? entry : null;
}

function collect1PasswordItems(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const root = data as {
    accounts?: unknown;
    vaults?: unknown;
    items?: unknown;
  };
  const items: unknown[] = [];
  const vaults: unknown[] = [];
  if (Array.isArray(root.accounts)) {
    for (const account of root.accounts) {
      if (account && typeof account === "object" && Array.isArray((account as { vaults?: unknown }).vaults)) {
        vaults.push(...((account as { vaults: unknown[] }).vaults));
      }
    }
  }
  if (Array.isArray(root.vaults)) vaults.push(...root.vaults);
  for (const vault of vaults) {
    if (vault && typeof vault === "object" && Array.isArray((vault as { items?: unknown }).items)) {
      items.push(...((vault as { items: unknown[] }).items));
    }
  }
  if (items.length === 0 && Array.isArray(root.items)) items.push(...root.items);
  return items;
}

function parse1PasswordJson(data: unknown): ImportResult | null {
  const items = collect1PasswordItems(data);
  if (items.length === 0) return null;
  const looks1p = items.some(
    (item) =>
      item &&
      typeof item === "object" &&
      ("categoryUuid" in item || "overview" in item || "secureContents" in item),
  );
  if (!looks1p) return null;
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const item of items) {
    const entry = parse1PasswordItem(item);
    if (!entry) {
      skipped += 1;
      continue;
    }
    entries.push(entry);
  }
  return { format: "onepassword-json", entries, skipped };
}

function parse1pif(text: string): ImportResult | null {
  if (!text.includes("typeName") || !text.includes("***")) return null;
  const entries: VaultEntry[] = [];
  let skipped = 0;
  for (const block of text.split(/\r?\n/)) {
    const line = block.trim();
    if (!line || line.startsWith("***")) continue;
    if (!line.startsWith("{")) {
      skipped += 1;
      continue;
    }
    try {
      const item = JSON.parse(line) as unknown;
      const entry = parse1PasswordItem(item);
      if (!entry) {
        skipped += 1;
        continue;
      }
      entries.push(entry);
    } catch {
      skipped += 1;
    }
  }
  if (entries.length === 0 && skipped === 0) return null;
  return { format: "onepassword-1pif", entries, skipped };
}

function unescapeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseKeepassXml(text: string): ImportResult | null {
  if (!/<KeePassFile[\s>]/i.test(text) && !(/<Entry[\s>]/i.test(text) && /<Key>Title<\/Key>/i.test(text))) {
    return null;
  }
  const entries: VaultEntry[] = [];
  let skipped = 0;
  const withoutHistory = text.replace(/<History>[\s\S]*?<\/History>/gi, "");
  const entryBlocks = withoutHistory.match(/<Entry\b[^>]*>[\s\S]*?<\/Entry>/gi) ?? [];
  for (const block of entryBlocks) {
    const fields = new Map<string, string>();
    const stringRe = /<String>\s*<Key>([^<]+)<\/Key>\s*<Value(?:\s[^>]*)?>([\s\S]*?)<\/Value>/gi;
    let match: RegExpExecArray | null;
    while ((match = stringRe.exec(block)) !== null) {
      fields.set(match[1]!.toLowerCase(), unescapeXml(match[2] ?? ""));
    }
    const entry = asEntry({
      title: fields.get("title") ?? "",
      username: fields.get("username") ?? "",
      password: fields.get("password") ?? "",
      url: fields.get("url") ?? "",
      notes: fields.get("notes") ?? "",
    });
    if (!usable(entry)) {
      skipped += 1;
      continue;
    }
    entries.push(entry);
  }
  return { format: "keepass-xml", entries, skipped };
}

/** Parse a plaintext password export. The file is never sent to the server. */
export function parsePlaintextExport(text: string): ImportResult {
  if (text.startsWith("PK") || text.includes("\0")) {
    throw new Error(
      "This file looks encrypted or zipped. Export 1Password as JSON (or unzip .1pux and import export.data). Export KeePass as XML or CSV, not .kdbx.",
    );
  }
  const trimmed = text.trim();
  if (looksLikeSharePackage(trimmed)) {
    throw new Error(
      "This is a 4AllPass share file, not a plaintext export. Import it and enter the share key.",
    );
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const bitwarden = parseBitwarden(parsed);
    if (bitwarden) return bitwarden;
    const onepassword = parse1PasswordJson(parsed);
    if (onepassword) return onepassword;
    throw new Error("JSON is not a Bitwarden or 1Password item export");
  }
  const keepass = parseKeepassXml(trimmed);
  if (keepass) return keepass;
  const pif = parse1pif(trimmed);
  if (pif) return pif;
  return parseCsv(trimmed);
}
