/** Plain language is the default. Expert is opt-in. Always DE + EN. */

export type CopyMode = "plain" | "expert";

/**
 * One language at a time. Every `Line` still carries both — that is what the
 * switch needs — but a surface shows exactly one, never "Öffnen / Unlock".
 */
export type Language = "de" | "en";

export type Line = { de: string; en: string };

const KEY = "4allpass.copy-mode";
const LANGUAGE_KEY = "4allpass.language";

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

/**
 * German until the user says otherwise.
 *
 * Deliberately not sniffed from `navigator.languages`: the desktop app runs
 * the same UI inside a WKWebView whose locale does not reliably follow the
 * Mac, so detection would make the *same build* start in different languages
 * depending on where it runs. A fixed default plus a visible switch is
 * predictable; auto-detection here is a guess that is wrong in the one place
 * we ship as a product.
 */
export function loadLanguage(
  storage: Pick<Storage, "getItem"> = localStorage,
): Language {
  return storage.getItem(LANGUAGE_KEY) === "en" ? "en" : "de";
}

export function saveLanguage(
  language: Language,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(LANGUAGE_KEY, language);
}

export function inLanguage(language: Language, line: Line): string {
  const wanted = line[language].trim();
  if (wanted) return wanted;
  // A missing translation must not render as an empty label.
  return (language === "de" ? line.en : line.de).trim();
}

/**
 * Kept for callers that genuinely want both at once — a first-run notice
 * shown before any language is chosen, for example. Not the default any more.
 */
export function bilingual(line: Line): string {
  const de = line.de.trim();
  const en = line.en.trim();
  if (!en || de === en) return de;
  return `${de} / ${en}`;
}

export function pick(
  mode: CopyMode,
  language: Language,
  plain: Line,
  expert?: Line,
): string {
  return inLanguage(language, mode === "expert" && expert ? expert : plain);
}
