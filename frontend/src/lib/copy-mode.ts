/**
 * Plain language is the default. Expert is opt-in.
 *
 * Sprache: Deutsch und Englisch, eine zur Zeit. Die Wahl liegt beim Nutzer und
 * wird gemerkt; ohne Wahl entscheidet der Browser, sonst Deutsch. Line traegt
 * weiterhin beide Sprachen — das ist die Voraussetzung dafuer, dass sich
 * ueberhaupt umschalten laesst.
 */

export type CopyMode = "plain" | "expert";

export type Lang = "de" | "en";

export const LANGUAGES: readonly Lang[] = ["de", "en"];

export const DEFAULT_LANGUAGE: Lang = "de";

export const LANGUAGE_NAMES: Record<Lang, string> = { de: "Deutsch", en: "English" };

export type Line = { de: string; en: string };

const KEY = "4allpass.copy-mode";
const LANG_KEY = "4allpass.lang";

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

/** Gibt immer eine unterstuetzte Sprache zurueck. */
export function normaliseLang(value: string | null | undefined): Lang {
  if (!value) return DEFAULT_LANGUAGE;
  const base = value.trim().toLowerCase().replace("_", "-").split("-", 1)[0];
  return LANGUAGES.includes(base as Lang) ? (base as Lang) : DEFAULT_LANGUAGE;
}

/** Erste unterstuetzte Sprache aus den Browser-Einstellungen. */
export function langFromNavigator(languages?: readonly string[]): Lang {
  const list = languages ?? (typeof navigator === "undefined" ? [] : navigator.languages);
  for (const entry of list ?? []) {
    const base = entry.trim().toLowerCase().replace("_", "-").split("-", 1)[0];
    if (LANGUAGES.includes(base as Lang)) return base as Lang;
  }
  return DEFAULT_LANGUAGE;
}

export function loadLang(
  storage: Pick<Storage, "getItem"> = localStorage,
  languages?: readonly string[],
): Lang {
  // Eine getroffene Wahl schlaegt den Browser. localStorage kann werfen
  // (privates Fenster, blockierte Site-Daten) — dann entscheidet der Browser.
  let stored: string | null = null;
  try {
    stored = storage.getItem(LANG_KEY);
  } catch {
    stored = null;
  }
  if (stored) return normaliseLang(stored);
  return langFromNavigator(languages);
}

export function saveLang(
  lang: Lang,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(LANG_KEY, lang);
  } catch {
    // Ohne Speicher bleibt die Wahl fuer diese Sitzung bestehen.
  }
}

/**
 * Beide Sprachen nebeneinander. Bleibt fuer Texte, die unabhaengig vom
 * Umschalter in beiden Sprachen stehen muessen — allen voran die
 * Notfall-Datei, die jemand ohne unsere Oberflaeche liest.
 */
export function bilingual(line: Line): string {
  const de = line.de.trim();
  const en = line.en.trim();
  if (!en || de === en) return de;
  return `${de} / ${en}`;
}

/** Eine Sprache. Fehlt sie, faellt der Text auf die andere zurueck statt zu verschwinden. */
export function render(lang: Lang, line: Line): string {
  const wanted = line[lang]?.trim();
  if (wanted) return wanted;
  const other = lang === "de" ? line.en : line.de;
  return other?.trim() ?? "";
}

/**
 * Ein Fehler, dessen Text der Nutzer zu sehen bekommt, und der deshalb beide
 * Sprachen traegt. message bleibt bewusst verschweisst: sie landet in Logs und
 * in Tests, nie unuebersetzt in der Oberflaeche — dort wird line gerendert.
 */
export class LineError extends Error {
  readonly line: Line;

  constructor(line: Line) {
    super(`${line.de} / ${line.en}`);
    this.name = "LineError";
    this.line = line;
  }
}

export function pick(mode: CopyMode, lang: Lang, plain: Line, expert?: Line): string {
  return render(lang, mode === "expert" && expert ? expert : plain);
}
