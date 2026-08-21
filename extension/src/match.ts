export interface FillEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
}

export function hostnameOf(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function entriesForPage(entries: FillEntry[], pageUrl: string): FillEntry[] {
  const pageHost = hostnameOf(pageUrl);
  if (!pageHost) return [];
  return entries.filter((entry) => {
    const entryHost = entry.url ? hostnameOf(entry.url) : null;
    if (!entryHost) return false;
    return entryHost === pageHost || pageHost.endsWith(`.${entryHost}`);
  });
}
