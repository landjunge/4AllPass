import type { ReactNode } from "react";
import { LANGUAGES, LANGUAGE_NAMES } from "../lib/copy-mode.ts";
import { useCopy } from "../state/copy-mode.tsx";

/**
 * Deutsch oder Englisch, eine zur Zeit. Steht im Kopf und damit auch vor der
 * Anmeldung zur Verfuegung — wer die Anmeldeseite nicht liest, kommt sonst
 * nicht bis zu den Einstellungen.
 */
export function LanguageSwitch(): ReactNode {
  const { lang, setLang, t } = useCopy();
  return (
    <div
      className="lang-switch"
      role="group"
      aria-label={t({ de: "Sprache", en: "Language" })}
      data-testid="language-switch"
    >
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className={code === lang ? "is-current" : ""}
          aria-pressed={code === lang}
          lang={code}
          title={LANGUAGE_NAMES[code]}
          data-testid={`language-${code}`}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
