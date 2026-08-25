export function isHttpUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:/.test(url));
}

export function pageOrigin(url: string | undefined): string | null {
  if (!isHttpUrl(url) || !url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Fill only if the tab is still the origin we matched. */
export function sameFillOrigin(matchedUrl: string, liveUrl: string | undefined): boolean {
  const matched = pageOrigin(matchedUrl);
  const live = pageOrigin(liveUrl);
  return Boolean(matched && live && matched === live);
}

/** Popup / service worker. A content-script sender has `tab.id`. */
export function isPrivilegedExtensionSender(sender: { tab?: { id?: number } | null }): boolean {
  return sender.tab == null || sender.tab.id === undefined;
}

/** Fill the website tab the user last focused — not the extension popup. */
export function pickFillTab<T extends { id?: number; url?: string }>(
  focused: T | undefined,
  remembered: T | undefined,
): T | undefined {
  if (focused?.id !== undefined && isHttpUrl(focused.url)) return focused;
  if (remembered?.id !== undefined && isHttpUrl(remembered.url)) return remembered;
  return undefined;
}
