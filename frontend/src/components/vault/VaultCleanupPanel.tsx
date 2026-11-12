import { useState, type ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { previewCleanup, type CleanupPreview, type SimilarGroup, type StaleFinding } from "../../utils/vault/cleanup.ts";
import { formatAgeDays } from "../../utils/vault/labels.ts";

/**
 * V7.4 — Aufräumen-Vorschau. One question: what looks similar and what is old?
 *
 * Purely a display surface: the analysis runs client-side only after an
 * explicit user click and shows similarity candidates and long-unchanged
 * entries. There is deliberately no keep/remove/delete/merge action here.
 * Titles, host and identity are shown; passwords are never rendered.
 */
export function VaultCleanupPanel({ entries }: { entries: VaultEntry[] }): ReactNode {
  const { t } = useCopy();
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });

  const similar = preview
    ? preview.findings.filter((finding): finding is SimilarGroup => finding.kind === "similar")
    : [];
  const stale = preview
    ? preview.findings.filter((finding): finding is StaleFinding => finding.kind === "stale")
    : [];

  return (
    <section className="card" data-testid="settings-cleanup">
      <h3>{t({ de: "Aufräumen-Vorschau", en: "Cleanup preview" })}</h3>
      <p className="hint">
        {t({
          de: "Zeigt Einträge, die sich ähnlich sehen, und Einträge, die lange nicht geändert wurden. Nur zur Kontrolle — es wird nichts verändert, zusammengeführt oder gelöscht.",
          en: "Shows entries that look similar and entries unchanged for a long time. For checking only — nothing is changed, merged or deleted.",
        })}
      </p>

      {preview === null ? (
        <button type="button" className="primary" data-testid="cleanup-run" onClick={() => setPreview(previewCleanup(entries))}>
          {t({ de: "Aufräumen prüfen", en: "Check cleanup" })}
        </button>
      ) : similar.length === 0 && stale.length === 0 ? (
        <>
          <p className="muted" data-testid="cleanup-empty">
            {t({
              de: "Keine ähnlichen oder lange unveränderten Einträge gefunden.",
              en: "No similar or long-unchanged entries found.",
            })}
          </p>
          <button type="button" className="link" data-testid="cleanup-close" onClick={() => setPreview(null)}>
            {t({ de: "Schließen", en: "Close" })}
          </button>
        </>
      ) : (
        <>
          {similar.length > 0 ? (
            <div>
              <h4>{t({ de: "Ähnliche Einträge", en: "Similar entries" })}</h4>
              <p className="hint">
                {t({
                  de: "Diese Einträge teilen Adresse und Benutzer. Sie werden nur angezeigt — entschieden wird nicht für dich.",
                  en: "These entries share an address and user. They are only shown — nothing is decided for you.",
                })}
              </p>
              <ul className="cleanup-list" data-testid="cleanup-similar">
                {similar.map((group) => (
                  <li key={group.entryIds.join(",")}>
                    <span className="muted">
                      {group.host}
                      {group.port ? `:${group.port}` : ""}
                      {" · "}
                      {group.identity}
                    </span>
                    {group.titles.map((title, index) => (
                      <div key={group.entryIds[index] ?? index}>
                        <strong>{title || untitled}</strong>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {stale.length > 0 ? (
            <div>
              <h4>{t({ de: "Lange unverändert", en: "Long unchanged" })}</h4>
              <p className="hint">
                {t({
                  de: "Diese Einträge wurden lange nicht mehr geändert. Sie werden nur angezeigt — es wird nichts entfernt.",
                  en: "These entries have not been changed in a long time. They are only shown — nothing is removed.",
                })}
              </p>
              <ul className="cleanup-list" data-testid="cleanup-stale">
                {stale.map((finding) => (
                  <li key={finding.entryId}>
                    <strong>{finding.title || untitled}</strong>
                    <span className="muted"> · {formatAgeDays(finding.ageDays, t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" className="link" data-testid="cleanup-close" onClick={() => setPreview(null)}>
            {t({ de: "Schließen", en: "Close" })}
          </button>
        </>
      )}
    </section>
  );
}
