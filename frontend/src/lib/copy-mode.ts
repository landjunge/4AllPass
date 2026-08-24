/** Plain language is the default. Expert is opt-in. Always DE + EN. */

export type CopyMode = "plain" | "expert";

export type Line = { de: string; en: string };

const KEY = "4allpass.copy-mode";

export function loadCopyMode(
  storage: Pick<Storage, "getItem"> = localStorage,
): CopyMode {
  return storage.getItem(KEY) === "expert" ? "expert" : "plain";
}

export function saveCopyMode(
  mode: CopyMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(KEY, mode);
}

export function bilingual(line: Line): string {
  const de = line.de.trim();
  const en = line.en.trim();
  if (!en || de === en) return de;
  return `${de} / ${en}`;
}

export function pick(mode: CopyMode, plain: Line, expert?: Line): string {
  return bilingual(mode === "expert" && expert ? expert : plain);
}
