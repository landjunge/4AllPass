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

export async function listBrowserProfiles(): Promise<BrowserCard[] | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<BrowserCard[]>("list_browser_profiles");
  } catch {
    return null;
  }
}
