export interface FillEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
}

export function hostnameOf(value: string): string | null {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
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
    if (entryHost && (entryHost === pageHost || pageHost.endsWith(`.${entryHost}`))) return true;
    const blob = `${entry.title} ${entry.url}`.toLowerCase();
    return blob.includes(pageHost);
  });
}
