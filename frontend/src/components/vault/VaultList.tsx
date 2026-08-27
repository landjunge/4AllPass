import type { ReactNode } from "react";
import { BrowserIcon } from "../BrowserIcon.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { entryDisplayTitle, entryIconName, entryMetaLine, kindLabel } from "../../utils/vault/labels.ts";
import { isWeakPassword } from "../../utils/vault/strength.ts";

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
        <div className="empty-mark" aria-hidden="true" />
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
          {query.trim()
            ? t({
                de: `Keine Treffer für „${query.trim()}“.`,
                en: `No matches for “${query.trim()}”.`,
              })
            : t({
                de: "Keine Einträge dieser Art.",
                en: "No entries of this kind.",
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
      {filtered.map((entry) => {
        const kind = kindLabel(entry.kind, t);
        const iconName = entryIconName(entry);
        const weak = isWeakPassword(entry.password);
        return (
          <li key={entry.id}>
            <button
              type="button"
              className={entry.id === selectedId ? "row active" : "row"}
              onClick={() => onSelect(entry)}
              title={t({ de: "Eintrag öffnen und bearbeiten", en: "Open and edit this entry" })}
            >
              <span className="row-icon" aria-hidden="true">
                <BrowserIcon id={iconName} name={iconName} />
              </span>
              <span className="row-body">
                <span className="row-top">
                  <strong>{entryDisplayTitle(entry, untitled)}</strong>
                  <span className="row-flags">
                    {weak ? (
                      <span
                        className="weak-dot"
                        title={t({
                          de: "Kurzes Passwort — nur Länge und Zeichenklassen, auf diesem Gerät.",
                          en: "Short password — length and character classes on this device only.",
                        })}
                      />
                    ) : null}
                    <span className={`kind-badge kind-${entry.kind}`}>{kind}</span>
                  </span>
                </span>
                <span className="row-meta muted">{entryMetaLine(entry, kind)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
