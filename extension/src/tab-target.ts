export function isHttpUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:/.test(url));
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
