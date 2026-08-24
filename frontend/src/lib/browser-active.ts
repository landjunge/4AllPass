/**
 * Which browsers the user turned on. Remembered per vault, on this device.
 * Green in the UI means this set — not “Chrome’s password store is in sync.”
 */
export interface BrowserActiveState {
  extensions: string[];
  profiles: string[];
}

const PREFIX = "4allpass.browser-active.";

export function loadBrowserActive(
  vaultId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): BrowserActiveState | null {
  if (!vaultId) return null;
  const raw = storage.getItem(PREFIX + vaultId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserActiveState>;
    const extensions = Array.isArray(parsed.extensions)
      ? parsed.extensions.filter((id): id is string => typeof id === "string")
      : [];
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.filter((id): id is string => typeof id === "string")
      : [];
    return { extensions, profiles };
  } catch {
    return null;
  }
}

export function saveBrowserActive(
  vaultId: string,
  state: BrowserActiveState,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  if (!vaultId) return;
  storage.setItem(
    PREFIX + vaultId,
    JSON.stringify({
      extensions: [...new Set(state.extensions)].sort(),
      profiles: [...new Set(state.profiles)].sort(),
    }),
  );
}
