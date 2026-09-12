import type { Line } from "../../lib/copy-mode.ts";
import { detectCredential, draftFromDetection } from "../../lib/detect.ts";
import { generatePassword } from "../../lib/entries.ts";
import type { EntryDraft } from "../../types/vault.ts";

const UNRECOGNIZED: Line = {
  de: "Nichts erkannt. Wähle Website, API oder SSH.",
  en: "Nothing recognized. Pick Web, API, or SSH/SFTP.",
};

const RECOGNIZED_SUFFIX: Line = {
  de: "Speichern legt es in den Tresor. Programme bekommen es nicht automatisch.",
  en: "Save stores it encrypted. Programs do not get it automatically.",
};

export function applyDetectedText(
  text: string,
  currentPassword: string | undefined,
): { draft: EntryDraft; label: Line } | { label: Line } {
  const found = detectCredential(text);
  if (!found) return { label: UNRECOGNIZED };
  return {
    draft: {
      ...draftFromDetection(found),
      password: found.password || currentPassword || generatePassword(),
    },
    label: {
      de: `${found.label}. ${RECOGNIZED_SUFFIX.de}`,
      en: `${found.label}. ${RECOGNIZED_SUFFIX.en}`,
    },
  };
}
