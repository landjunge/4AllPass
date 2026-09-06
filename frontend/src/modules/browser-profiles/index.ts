export interface BrowserProfile {
  id: string;
  name: string;
  dirName: string;
}

export interface BrowserCard {
  id: string;
  name: string;
  kind: string;
  installed: boolean;
  profiles: BrowserProfile[];
}

export interface ExtensionInstall {
  browserId: string;
  flavor: string;
  bundlePath: string;
  appName: string;
  page: string;
}

export interface BrowserLoginRow {
  url: string;
  username: string;
  password: string;
  title: string;
  source: string;
}

export interface BrowserActiveState {
  extensions: string[];
  profiles: string[];
}

const PREFIX = "4allpass.browser-active.";

export function profileKey(browserId: string, profileId: string): string {
  return `${browserId}:${profileId}`;
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listBrowserProfiles(): Promise<BrowserCard[] | null> {
  if (!isDesktopShell()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<BrowserCard[]>("list_browser_profiles");
}

export async function extensionInstall(browserId: string): Promise<ExtensionInstall> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<ExtensionInstall>("extension_install", { browserId });
}

export async function openBrowserForExtension(browserId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_browser_for_extension", { browserId });
}

export async function openAutofillDemo(browserId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_autofill_demo", { browserId });
}

export async function importBrowserLogins(
  browserId: string,
  profileId: string,
): Promise<BrowserLoginRow[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<BrowserLoginRow[]>("import_browser_logins", { browserId, profileId });
}

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
