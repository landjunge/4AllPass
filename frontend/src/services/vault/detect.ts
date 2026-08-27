import { detectCredential, draftFromDetection } from "../../lib/detect.ts";
import { generatePassword } from "../../lib/entries.ts";
import type { EntryDraft } from "../../types/vault.ts";

const UNRECOGNIZED =
  "Nichts erkannt. Wähle Website, API oder SSH. / Nothing recognized. Pick Web, API, or SSH/SFTP.";

const RECOGNIZED_SUFFIX =
  "Speichern legt es in den Tresor. Programme bekommen es nicht automatisch. / Save stores it encrypted. Programs do not get it automatically.";

export function applyDetectedText(
  text: string,
  currentPassword: string | undefined,
): { draft: EntryDraft; label: string } | { label: string } {
  const found = detectCredential(text);
  if (!found) return { label: UNRECOGNIZED };
  return {
    draft: {
      ...draftFromDetection(found),
      password: found.password || currentPassword || generatePassword(),
    },
    label: `${found.label}. ${RECOGNIZED_SUFFIX}`,
  };
}
