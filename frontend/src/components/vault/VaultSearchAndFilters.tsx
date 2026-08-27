import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { EntryKind } from "../../types/vault.ts";

export function VaultSearchAndFilters({
  query,
  onQueryChange,
  onAdd,
  onImportFile,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onAdd: (kind?: EntryKind) => void;
  onImportFile: (file: File) => void;
}): ReactNode {
  const { t } = useCopy();
  const searchTip = t({
    de: "Suche in Name, Benutzername, URL, Anbieter und Host.",
    en: "Search name, username, URL, provider, and host.",
  });
  const addTip = t({
    de: "Neuen Website-Login anlegen. Weitere Arten über +.",
    en: "Create a new website login. More types via +.",
  });
  const importTip = t({
    de: "Bitwarden, 1Password, KeePass, CSV oder eine 4AllPass-Share-Datei. Die Datei bleibt auf diesem Gerät.",
    en: "Bitwarden, 1Password, KeePass, CSV, or a 4AllPass share file. The file stays on this device.",
  });
  return (
    <div className="list-header">
      <label className="search-field">
        <span className="sr-only">{t({ de: "Suchen", en: "Search" })}</span>
        <input
          type="search"
          placeholder={t({ de: "Name, URL oder Benutzername", en: "Name, URL, or username" })}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t({ de: "Suchen", en: "Search" })}
          title={searchTip}
        />
      </label>
      <div className="add-split">
        <button
          type="button"
          className="primary"
          onClick={() => onAdd("web")}
          data-testid="new-entry"
          title={addTip}
        >
          {t({ de: "+ Login hinzufügen", en: "+ Add login" })}
        </button>
        <details className="add-more">
          <summary
            aria-label={t({ de: "Weitere Arten", en: "More types" })}
            title={t({
              de: "API-Key oder Server-Zugang statt Website-Login",
              en: "API key or server login instead of a website login",
            })}
          >
            +
          </summary>
          <button type="button" onClick={() => onAdd("api")} title={t({ de: "Token oder API-Key", en: "Token or API key" })}>
            API-Key
          </button>
          <button
            type="button"
            onClick={() => onAdd("sftp")}
            title={t({ de: "SSH, SFTP oder FTP-Zugang", en: "SSH, SFTP, or FTP login" })}
          >
            {t({ de: "Server-Zugang", en: "Server login" })}
          </button>
        </details>
      </div>
      <label
        className="import-file"
        title={importTip}
      >
        {t({ de: "Datei importieren", en: "Import file" })}
        <input
          type="file"
          accept=".json,.csv,.xml,.1pif,application/json,text/csv,application/xml,text/xml"
          data-testid="import-file"
          aria-label={t({ de: "Datei importieren", en: "Import file" })}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onImportFile(file);
          }}
        />
      </label>
    </div>
  );
}
