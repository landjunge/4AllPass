import {
  buildSharePackage,
  downloadShareFile,
  openSharePackage,
  type BuiltShare,
} from "../../lib/share.ts";
import type { VaultEntry } from "../../types/vault.ts";

export function createEntryShare(entry: VaultEntry): BuiltShare {
  return buildSharePackage([entry]);
}

export function decryptSharePackage(text: string, key: string): VaultEntry[] {
  const opened = openSharePackage(text, key);
  if (opened.length === 0) {
    throw new Error("Share-Datei ohne Logins. / share file had no logins");
  }
  return opened;
}

export { downloadShareFile };
