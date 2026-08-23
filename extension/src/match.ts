import { resolveProvider } from "@4allpass/providers";

export interface FillEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  providerId?: string;
  totpSecret?: string;
}

const PROVIDER_FILL_MIN = 0.95;

export function hostnameOf(value: string): string | null {
  try {
    // URL.hostname, not string splits: github.com@evil.com → evil.com;
    // IDN homographs → punycode. Tests in match.test.ts.
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function hostMatch(pageHost: string, entryUrl: string): boolean {
  const entryHost = hostnameOf(entryUrl);
  if (!entryHost) return false;
  return entryHost === pageHost || pageHost.endsWith(`.${entryHost}`);
}

/** Same provider only at high confidence. Origin suffix still wins first. */
function providerMatch(pageUrl: string, entry: FillEntry): boolean {
  const page = resolveProvider(pageUrl);
  if (!page.providerId || page.confidence < PROVIDER_FILL_MIN) return false;
  if (entry.providerId && entry.providerId === page.providerId) return true;
  if (!entry.url) return false;
  const stored = resolveProvider(entry.url);
  return stored.providerId === page.providerId && stored.confidence >= PROVIDER_FILL_MIN;
}

export function entriesForPage(entries: FillEntry[], pageUrl: string): FillEntry[] {
  const pageHost = hostnameOf(pageUrl);
  if (!pageHost) return [];
  return entries.filter((entry) => {
    if (entry.url && hostMatch(pageHost, entry.url)) return true;
    return providerMatch(pageUrl, entry);
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
