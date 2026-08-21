/**
 * Optional Tauri shell. Missing in a normal browser — overlay is enough there.
 * Never pass vault secrets through these calls.
 */

export interface DesktopAccessDetail {
  requestId: string;
  application: string;
  provider: string;
  scope: string[];
  ttlSeconds: number;
}

export interface DesktopAccessDecision {
  requestId: string;
  allow: boolean;
}

export async function promptDesktopAccess(detail: DesktopAccessDetail): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("access_prompt", {
      requestId: detail.requestId,
      application: detail.application,
      provider: detail.provider,
      scope: detail.scope,
      ttlSeconds: detail.ttlSeconds,
    });
    return true;
  } catch {
    // Browser / PWA: the in-app dialog is the prompt.
    return false;
  }
}

export async function dismissDesktopAccess(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("access_dismiss");
  } catch {
    // Browser / PWA.
  }
}

export async function launchAtLoginEnabled(): Promise<boolean | null> {
  try {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return await isEnabled();
  } catch {
    return null;
  }
}

export async function setLaunchAtLogin(enabled: boolean): Promise<boolean> {
  try {
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    if (enabled) await enable();
    else await disable();
    return true;
  } catch {
    return false;
  }
}

export async function listenDesktopLock(handler: () => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen("desktop-lock", () => {
      handler();
    });
  } catch {
    return () => undefined;
  }
}

export async function listenDesktopAccessDecision(
  handler: (decision: DesktopAccessDecision) => void,
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<DesktopAccessDecision>("access-decision", (event) => {
      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}
