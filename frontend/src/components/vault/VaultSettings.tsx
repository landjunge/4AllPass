import type { ReactNode } from "react";
import { DevicesPanel } from "../DevicesPanel.tsx";
import { SettingsPanel } from "../SettingsPanel.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import type { SettingsPane } from "../../types/vault.ts";

export function VaultSettings({
  pane,
  onPaneChange,
  revision,
  vaultKeyVersion,
}: {
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
  revision: number;
  vaultKeyVersion: number;
}): ReactNode {
  const { t } = useCopy();
  return (
    <div className="settings-stack">
      <nav className="tabs subtabs" aria-label={t({ de: "Einstellungen", en: "Settings sections" })}>
        <button
          type="button"
          className={pane === "general" ? "active" : ""}
          onClick={() => onPaneChange("general")}
        >
          {t({ de: "Allgemein", en: "General" })}
        </button>
        <button
          type="button"
          className={pane === "devices" ? "active" : ""}
          onClick={() => onPaneChange("devices")}
          data-testid="tab-devices"
        >
          {t({ de: "Geräte", en: "Devices" })}
        </button>
        <button
          type="button"
          className={pane === "security" ? "active" : ""}
          onClick={() => onPaneChange("security")}
          data-testid="tab-security"
        >
          {t({ de: "Sicherheit", en: "Security" })}
        </button>
      </nav>
      {pane === "devices" ? (
        <DevicesPanel />
      ) : pane === "security" ? (
        <section className="card" data-testid="settings-security">
          <h3>{t({ de: "Kontrolle", en: "Checking" })}</h3>
          <p className="hint">
            {t({
              de: "Nur zur Kontrolle. Für den Alltag brauchst du das nicht.",
              en: "For checking. Everyday use does not need this.",
            })}
          </p>
          <dl className="tech-dl" data-testid="settings-revision">
            <div>
              <dt>AES-256-GCM</dt>
              <dd>{t({ de: "Verschlüsselung auf diesem Gerät", en: "Encryption on this device" })}</dd>
            </div>
            <div>
              <dt>{t({ de: "Tresor-Stand", en: "Vault revision" })}</dt>
              <dd>revision {revision}</dd>
            </div>
            <div>
              <dt>Vault Key</dt>
              <dd>generation {vaultKeyVersion}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}
