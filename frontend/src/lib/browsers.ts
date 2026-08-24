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

export interface ExtensionInstall {
  browserId: string;
  flavor: string;
  bundlePath: string;
  appName: string;
  page: string;
}

export async function extensionInstall(browserId: string): Promise<ExtensionInstall> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<ExtensionInstall>("extension_install", { browserId });
}

export async function openBrowserForExtension(browserId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_browser_for_extension", { browserId });
}

/** Opens the hardcoded loopback demo login in that browser. Not a general URL opener. */
export async function openAutofillDemo(browserId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_autofill_demo", { browserId });
}

export interface BrowserLoginRow {
  url: string;
  username: string;
  password: string;
  title: string;
  source: string;
}

export async function importBrowserLogins(
  browserId: string,
  profileId: string,
): Promise<BrowserLoginRow[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<BrowserLoginRow[]>("import_browser_logins", { browserId, profileId });
}
