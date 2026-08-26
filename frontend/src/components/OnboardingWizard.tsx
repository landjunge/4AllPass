import { type ReactNode } from "react";
import { useCopy } from "../state/copy-mode.tsx";
import { BrowserCards } from "./BrowserCards.tsx";
import type { BrowserLoginRow } from "../lib/browsers.ts";

export function OnboardingWizard({
  vaultId,
  onLogins,
  onEnsureDemoLogin,
  onDone,
}: {
  vaultId: string;
  onLogins: (rows: BrowserLoginRow[]) => void;
  onEnsureDemoLogin: () => Promise<void>;
  onDone: () => void;
}): ReactNode {
  const { t } = useCopy();

  return (
    <section className="card onboarding" data-testid="onboarding">
      <h2>{t({ de: "Willkommen in deinem Tresor", en: "Welcome to your vault" })}</h2>
      <p className="muted">
        {t({
          de: "Zuerst: welche Browser sollen mit 4AllPass arbeiten? Dann importieren und Autofill einschalten.",
          en: "First: which browsers should work with 4AllPass? Then import and turn on autofill.",
        })}
      </p>
      <ol className="onboarding-steps">
        <li className="done">
          <strong>1. {t({ de: "Tresor erstellt", en: "Vault created" })}</strong> ✓
        </li>
        <li className="active">
          <strong>2. {t({ de: "Browser verbinden", en: "Connect browsers" })}</strong>
          <p className="hint">
            {t({
              de: "Chrome, Firefox oder Safari. Autofill einschalten, Profile anhaken, importieren. Passwörter siehst du in der Liste nicht.",
              en: "Chrome, Firefox, or Safari. Turn on autofill, tick profiles, import. Passwords do not appear in the list.",
            })}
          </p>
          <BrowserCards
            vaultId={vaultId}
            onLogins={onLogins}
            onEnsureDemoLogin={onEnsureDemoLogin}
          />
        </li>
        <li>
          <strong>3. {t({ de: "Autofill aktivieren", en: "Turn on autofill" })}</strong>
          <p className="hint">
            {t({
              de: "Erweiterung in dem Browser einmal erlauben. Danach füllt 4AllPass Logins auf der Seite.",
              en: "Allow the add-on once in that browser. Then 4AllPass fills logins on the page.",
            })}
          </p>
        </li>
        <li>
          <strong>4. {t({ de: "Fertig", en: "Done" })}</strong>
        </li>
      </ol>
      <div className="actions">
        <button type="button" className="primary" data-testid="onboarding-done" onClick={onDone}>
          {t({ de: "Zum Tresor", en: "Go to vault" })}
        </button>
        <button type="button" className="link" data-testid="onboarding-skip" onClick={onDone}>
          {t({ de: "Überspringen", en: "Skip" })}
        </button>
      </div>
    </section>
  );
}
