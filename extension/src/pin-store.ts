/**
 * `ext.storage.local`-backed revision pin. Split from `revision-pin.ts` so the
 * unlock path can be tested without a WebExtension API.
 */
import { ext } from "./browser.ts";
import { PIN_PREFIX, pinFromStored, pinToStored, type PinStore } from "./revision-pin.ts";

export function extensionPinStore(): PinStore {
  return {
    async load(vaultId) {
      const key = PIN_PREFIX + vaultId;
      const stored = await ext.storage.local.get(key);
      return pinFromStored(vaultId, (stored as Record<string, unknown>)[key]);
    },
    async save(pin) {
      await ext.storage.local.set({ [PIN_PREFIX + pin.vaultId]: pinToStored(pin) });
    },
  };
}
