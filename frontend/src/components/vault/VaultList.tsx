import type { ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { entryDisplayTitle, kindLabel } from "../../utils/vault/labels.ts";

export function VaultList({
  entries,
  filtered,
  selectedId,
  query,
  onSelect,
  onAdd,
}: {
  entries: VaultEntry[];
  filtered: VaultEntry[];
  selectedId: string | null;
  query: string;
  onSelect: (entry: VaultEntry) => void;
  onAdd: () => void;
}): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });

  if (filtered.length === 0 && entries.length === 0) {
    return (
      <div className="vault-empty" data-testid="vault-empty">
        <p className="muted empty">{t({ de: "Noch keine Zugänge.", en: "No logins yet." })}</p>
        <p className="hint">
          {t({
            de: "Lege einen Login an oder importiere eine Datei aus einem anderen Tresor.",
            en: "Add a login or import a file from another vault.",
          })}
        </p>
        <button type="button" className="primary" onClick={onAdd}>
          {t({ de: "Erstes Login anlegen", en: "Create first login" })}
        </button>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="vault-empty" data-testid="vault-search-empty">
        <p className="muted empty">
          {t({
            de: `Keine Treffer für „${query.trim()}“.`,
            en: `No matches for “${query.trim()}”.`,
          })}
        </p>
        <p className="hint">
          {t({
            de: "Suche nach Name, Benutzername, URL oder Anbieter. Filter löschen, um alle Einträge zu sehen.",
            en: "Search by name, username, URL, or provider. Clear the filter to see every entry.",
          })}
        </p>
      </div>
    );
  }

  return (
    <ul>
      {filtered.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            className={entry.id === selectedId ? "row active" : "row"}
            onClick={() => onSelect(entry)}
            title={t({ de: "Eintrag öffnen und bearbeiten", en: "Open and edit this entry" })}
          >
            <span className="row-top">
              <strong>{entryDisplayTitle(entry, untitled)}</strong>
              <span className={`kind-badge kind-${entry.kind}`}>{kindLabel(entry.kind, t)}</span>
            </span>
            {entry.username || entry.account || entry.host ? (
              <span className="muted">
                {entry.username || entry.account || entry.host}
              </span>
            ) : (
              <span className="muted">{kindLabel(entry.kind, t)}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
