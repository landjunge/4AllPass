/**
 * AP host wrapper for the shared five-product appbar (module 1.2.1, Franklin).
 *
 * Loads the raw ES module from the pinned public bundle (`/networkpunkt/…`) and
 * binds only the host-specific hooks:
 * - `readSelf` maps the 4AllPass lock state to the appbar self-state vocabulary
 *   (`unlocked` / `locked` / `vaultUnknown`). "App open" is never reported as a
 *   connected peer.
 * - `openTarget` forwards only the catalog id to the native `family_switch`
 *   command; in a browser/PWA it reports `missing`. No URL, pid or argv crosses
 *   this boundary from the web.
 */
import { familySwitch, type FamilySwitchOutcome } from "../modules/desktop-adapter/index.ts";
import { isTauriShell } from "./webauthnCapabilities.ts";

export interface ProductHeaderApi {
  bar: unknown;
  refresh(): void;
  setLocale(locale: string): void;
  destroy(): void;
}

interface ProductHeaderModule {
  mountProductHeader(
    element: HTMLElement,
    options: {
      selfId: string;
      locale?: string;
      readSelf?: (arg: { signal: AbortSignal }) => Promise<{ state: string; version?: string }>;
      openTarget?: (appId: string) => Promise<FamilySwitchOutcome>;
    },
  ): ProductHeaderApi;
}

export function mapLockState(lockState: string): string {
  if (lockState === "UNLOCKED") return "unlocked";
  if (lockState === "LOCKED") return "locked";
  return "vaultUnknown";
}

export async function mountFamilyHeader(
  element: HTMLElement,
  options: { locale: string; lockState: () => string },
): Promise<ProductHeaderApi> {
  // Raw ES module served from public/networkpunkt, intentionally not bundled.
  const specifier = "/networkpunkt/networkpunkt-product-header.js";
  const mod = (await import(/* @vite-ignore */ specifier)) as ProductHeaderModule;
  return mod.mountProductHeader(element, {
    selfId: "4allpass",
    locale: options.locale,
    readSelf: async () => ({ state: mapLockState(options.lockState()) }),
    openTarget: isTauriShell() ? (appId) => familySwitch(appId) : async () => "missing",
  });
}
