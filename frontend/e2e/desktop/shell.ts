import type { Page } from "@playwright/test";

/**
 * Desktop first-run skips silent /auth/local because __TAURI_INTERNALS__ is set.
 * API then goes through invoke("sidecar_http") — forward that to the test origin.
 * Never attach to /Applications/4AllPass.app (Daniel's vault).
 */
export async function stubDesktopShell(page: Page, origin: string): Promise<void> {
  await page.addInitScript((apiOrigin: string) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (
          cmd: string,
          args?: {
            method?: string;
            path?: string;
            headers?: Record<string, string>;
            body?: string | null;
          },
        ) => {
          if (cmd === "sidecar_http") {
            const res = await fetch(`${apiOrigin}${args?.path ?? ""}`, {
              method: args?.method ?? "GET",
              headers: args?.headers,
              body: args?.body ?? undefined,
            });
            return { status: res.status, body: await res.text() };
          }
          if (cmd === "list_browser_profiles") return [];
          if (cmd === "plugin:autostart|is_enabled") return false;
          if (cmd === "access_prompt" || cmd === "access_dismiss") return;
          return null;
        },
        transformCallback: () => 0,
        unregisterCallback: () => undefined,
      },
    });
  }, origin);
}
