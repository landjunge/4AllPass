import { useState, type ReactNode } from "react";
import { openTollgateDashboard } from "../../modules/desktop-adapter/index.ts";
import { useCopy } from "../../state/copy-mode.tsx";

/**
 * Issue #279, point 9 ("Kosten/Limits") — intentionally thin. TollGate is a
 * separate, self-contained product (its own local server, its own HTTP
 * API). This panel never calls that API: it only opens TollGate's dashboard
 * in the external browser, the same fixed-URL/OS-open pattern
 * `VaultKeyCheckPanel`'s sibling `open_provider_key_page` (#278) uses. No
 * live limits or spend are read or shown here, and no vault key or
 * password ever reaches TollGate.
 */
export function VaultTollgatePanel(): ReactNode {
  const { t } = useCopy();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleOpen(): Promise<void> {
    setOpening(true);
    setFailed(false);
    try {
      const ok = await openTollgateDashboard();
      if (!ok) setFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="card" data-testid="settings-tollgate">
      <h3>{t({ de: "Kosten & Kontingente", en: "Cost & limits" })}</h3>
      <p className="hint">
        {t({
          de: "Anbieter-Kontingente und Kosten für API-Schlüssel-Einträge verwaltet das separate, eigenständige Werkzeug TollGate — nicht 4AllPass. 4AllPass liest TollGates Limits nicht, zeigt hier keine Live-Daten und übernimmt nicht dessen Zuständigkeit: die Durchsetzung von Limits bleibt bei TollGate.",
          en: "Provider quotas and cost for API key entries are managed by the separate, self-contained tool TollGate — not by 4AllPass. 4AllPass does not read TollGate's limits, shows no live data here, and does not take over its responsibility: enforcing limits stays with TollGate.",
        })}
      </p>
      <p className="hint">
        {t({
          de: "4AllPass sendet dabei niemals einen Tresorschlüssel oder ein Passwort an TollGate. Der Button öffnet nur TollGates Dashboard im normalen Browser — kein Datenabruf aus 4AllPass heraus.",
          en: "4AllPass never sends a vault key or password to TollGate. The button only opens TollGate's dashboard in the regular browser — no data is fetched from inside 4AllPass.",
        })}
      </p>
      <button type="button" className="link" data-testid="tollgate-open" disabled={opening} onClick={() => void handleOpen()}>
        {opening ? t({ de: "Öffnet …", en: "Opening …" }) : t({ de: "TollGate-Dashboard öffnen", en: "Open TollGate dashboard" })}
      </button>
      {failed ? (
        <p className="muted" data-testid="tollgate-open-failed">
          {t({
            de: "Konnte nicht geöffnet werden. Läuft TollGate lokal (tollgate serve)?",
            en: "Could not open it. Is TollGate running locally (tollgate serve)?",
          })}
        </p>
      ) : null}
    </section>
  );
}
