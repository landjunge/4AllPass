import { resolveProvider } from "@4allpass/providers";

export interface FillEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  kind?: string;
  providerId?: string;
  totpSecret?: string;
}

const PROVIDER_FILL_MIN = 0.95;

/**
 * Each child label is a different tenant. Not a full Public Suffix List —
 * only the shared parents we refuse to suffix-match.
 */
const SHARED_PARENT_HOSTS = new Set([
  "github.io",
  "githubusercontent.com",
  "herokuapp.com",
  "netlify.app",
  "vercel.app",
  "appspot.com",
  "azurewebsites.net",
  "pages.dev",
  "web.app",
  "glitch.me",
  "tumblr.com",
  "wordpress.com",
]);

export function hostnameOf(value: string): string | null {
  try {
    // URL.hostname, not string splits: github.com@evil.com → evil.com;
    // IDN homographs → punycode. Tests in match.test.ts.
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

/** HTTPS always. HTTP only on loopback, or when the stored URL is itself HTTP. */
function pageSchemeAllowsFill(pageUrl: string, entryUrl: string): boolean {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  if (page.protocol === "https:") return true;
  if (page.protocol !== "http:") return false;
  if (isLoopbackHost(page.hostname)) return true;
  if (!entryUrl) return false;
  try {
    return new URL(entryUrl).protocol === "http:";
  } catch {
    return false;
  }
}

function hostMatch(pageHost: string, entryUrl: string): boolean {
  const entryHost = hostnameOf(entryUrl);
  if (!entryHost) return false;
  if (entryHost === pageHost) return true;
  // Suffix only when the stored host has at least two labels. Otherwise a
  // CSV row `https://com/` would match github.com (and every other .com).
  const labels = entryHost.split(".").filter(Boolean);
  if (labels.length < 2) return false;
  if (SHARED_PARENT_HOSTS.has(entryHost)) return false;
  return pageHost.endsWith(`.${entryHost}`);
}

/** Overwrite unlocked strings. JS cannot securely zeroize; still clear all of them. */
export function wipeFillEntry(entry: FillEntry): void {
  entry.username = "";
  entry.password = "";
  entry.totpSecret = "";
}

/**
 * Same provider only at high confidence. Origin suffix still wins first.
 * A stored URL is the source of truth: a `providerId` tag must not override
 * a conflicting host (evilgithub.com tagged github ≠ github.com).
 */
function providerMatch(pageUrl: string, entry: FillEntry): boolean {
  const page = resolveProvider(pageUrl);
  if (!page.providerId || page.confidence < PROVIDER_FILL_MIN) return false;
  if (entry.url) {
    const stored = resolveProvider(entry.url);
    return stored.providerId === page.providerId && stored.confidence >= PROVIDER_FILL_MIN;
  }
  return Boolean(entry.providerId && entry.providerId === page.providerId);
}

export function entriesForPage(entries: FillEntry[], pageUrl: string): FillEntry[] {
  const pageHost = hostnameOf(pageUrl);
  if (!pageHost) return [];
  return entries.filter((entry) => {
    if (!pageSchemeAllowsFill(pageUrl, entry.url)) return false;
    if (entry.url && hostMatch(pageHost, entry.url)) return true;
    return providerMatch(pageUrl, entry);
  });
}

/**
 * API-key suggestion: only `kind: "api"` rows whose stored URL (or tag)
 * resolves to this provider. A GitHub login password is not an OpenAI key.
 */
export function entriesForProvider(entries: FillEntry[], providerId: string): FillEntry[] {
  if (!providerId) return [];
  return entries.filter((entry) => {
    if (entry.kind !== "api") return false;
    if (entry.url) {
      const stored = resolveProvider(entry.url);
      return stored.providerId === providerId && stored.confidence >= PROVIDER_FILL_MIN;
    }
    return Boolean(entry.providerId && entry.providerId === providerId);
  });
}

/** Popup list only — never the password. */
export function maskUsername(name: string): string {
  const value = name.trim();
  if (!value) return "";
  const at = value.indexOf("@");
  if (at > 0) {
    const user = value.slice(0, at);
    const domain = value.slice(at + 1);
    const head = user.charAt(0);
    return `${head}***@${domain}`;
  }
  if (value.length <= 2) return "*".repeat(value.length);
  return `${value.charAt(0)}***${value.charAt(value.length - 1)}`;
}

export function publicPicks(entries: FillEntry[]): Array<{ id: string; title: string; username: string }> {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    username: maskUsername(entry.username),
  }));
}
