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
          de: "Installieren → Importieren → Autofill → fertig.",
          en: "Install → Import → Autofill → done.",
        })}
      </p>
      <ol className="onboarding-steps">
        <li className="done">
          <strong>1. {t({ de: "Tresor erstellt", en: "Vault created" })}</strong> ✓
        </li>
        <li className="active">
          <strong>2. {t({ de: "Passwörter übernehmen", en: "Bring in passwords" })}</strong>
          <p className="hint">
            {t({
              de: "Browser wählen, Profile anhaken, importieren. Passwörter siehst du in der Liste nicht.",
              en: "Pick a browser, tick profiles, import. Passwords do not appear in the list.",
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
              de: "Unter Browser die Erweiterung laden. Danach füllt 4AllPass Logins auf der Seite.",
              en: "Load the extension under Browser. Then 4AllPass fills logins on the page.",
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
