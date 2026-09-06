import type { ReactNode } from "react";
import { BrowserIcon } from "../BrowserIcon.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { groupVaultSections, type EntryHealth, type HealthIssue } from "../../utils/vault/health.ts";
import {
  entryDisplayTitle,
  entryIconName,
  entryMetaLine,
  formatRelativeChanged,
  kindLabel,
} from "../../utils/vault/labels.ts";

export function VaultList({
  entries,
  filtered,
  health,
  selectedId,
  query,
  onSelect,
  onAdd,
  onToggleFavorite,
}: {
  entries: VaultEntry[];
  filtered: VaultEntry[];
  health: EntryHealth[];
  selectedId: string | null;
  query: string;
  onSelect: (entry: VaultEntry) => void;
  onAdd: () => void;
  onToggleFavorite: (entry: VaultEntry) => void;
}): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  const now = Date.now();
  const issuesById = new Map(health.map((row) => [row.id, row.issues]));
  const groups = groupVaultSections(filtered, health);

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
    <div className="vault-sections">
      {groups.favorites.length > 0 ? (
        <ListSection title={t({ de: "Favoriten", en: "Favorites" })}>
          {groups.favorites.map((entry) =>
            renderRow(entry, {
              selectedId,
              untitled,
              now,
              t,
              issues: issuesById.get(entry.id) ?? [],
              onSelect,
              onToggleFavorite,
            }),
          )}
        </ListSection>
      ) : null}
      {groups.attention.length > 0 ? (
        <ListSection title={t({ de: "Aufmerksamkeit", en: "Needs attention" })}>
          {groups.attention.map((entry) =>
            renderRow(entry, {
              selectedId,
              untitled,
              now,
              t,
              issues: issuesById.get(entry.id) ?? [],
              onSelect,
              onToggleFavorite,
            }),
          )}
        </ListSection>
      ) : null}
      {groups.recent.length > 0 ? (
        <ListSection title={t({ de: "Zuletzt geändert", en: "Last changed" })}>
          {groups.recent.map((entry) =>
            renderRow(entry, {
              selectedId,
              untitled,
              now,
              t,
              issues: issuesById.get(entry.id) ?? [],
              onSelect,
              onToggleFavorite,
            }),
          )}
        </ListSection>
      ) : null}
    </div>
  );
}

function ListSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="list-section">
      <h3 className="list-section-title">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function renderRow(
  entry: VaultEntry,
  opts: {
    selectedId: string | null;
    untitled: string;
    now: number;
    t: ReturnType<typeof useCopy>["t"];
    issues: HealthIssue[];
    onSelect: (entry: VaultEntry) => void;
    onToggleFavorite: (entry: VaultEntry) => void;
  },
): ReactNode {
  const kind = kindLabel(entry.kind, opts.t);
  const iconName = entryIconName(entry);
  const changed = formatRelativeChanged(entry.updatedAt, opts.now, opts.t);
  return (
    <li key={entry.id}>
      <div className={entry.id === opts.selectedId ? "row active" : "row"}>
        <button
          type="button"
          className={entry.favorite ? "fav-star on" : "fav-star"}
          aria-pressed={entry.favorite}
          data-testid={`fav-star-${entry.id}`}
          aria-label={opts.t({ de: "Favorit", en: "Favorite" })}
          title={opts.t({ de: "Favorit umschalten", en: "Toggle favorite" })}
          onClick={() => opts.onToggleFavorite(entry)}
        >
          ★
        </button>
        <button
          type="button"
          className="row-main"
          onClick={() => opts.onSelect(entry)}
          title={entryDisplayTitle(entry, opts.untitled)}
        >
          <span className="row-icon" aria-hidden="true">
            <BrowserIcon id={iconName} name={iconName} />
          </span>
          <span className="row-body">
            <span className="row-top">
              <strong>{entryDisplayTitle(entry, opts.untitled)}</strong>
              <span className="row-flags">
                {opts.issues.includes("leaked") ? (
                  <span className="issue-pill leaked">{opts.t({ de: "geleakt", en: "leaked" })}</span>
                ) : null}
                {opts.issues.includes("reused") ? (
                  <span className="issue-pill reused">{opts.t({ de: "doppelt", en: "reused" })}</span>
                ) : null}
                {opts.issues.includes("weak") ? (
                  <span className="weak-dot" title={opts.t({ de: "Schwach nach ZXCVBN.", en: "Weak by ZXCVBN." })} />
                ) : null}
                <span className={`kind-badge kind-${entry.kind}`}>{kind}</span>
              </span>
            </span>
            <span className="row-meta muted">
              {entryMetaLine(entry, kind)}
              {" · "}
              {opts.t({ de: `Zuletzt geändert: ${changed}`, en: `Last changed: ${changed}` })}
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}
