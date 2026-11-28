import { useState, type ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import {
  cleanupFindingKey,
  previewCleanup,
  runMatchesEntries,
  type CleanupApplyRejected,
  type CleanupApplyResult,
  type CleanupRun,
  type SimilarGroup,
  type StaleFinding,
} from "../../utils/vault/cleanup.ts";
import { formatAgeDays } from "../../utils/vault/labels.ts";

/**
 * V7.4 — Aufräumen: Vorschau + kontrollierte Übernahme (issue #279 #1).
 *
 * The analysis runs client-side only after an explicit user click and shows
 * similarity candidates and long-unchanged entries. Nothing is ever changed
 * by looking at it. Applying is a second, separate, explicit step: every
 * proposed change starts selected but can be individually deselected, the
 * button is labelled with exactly what the current selection does, and the
 * action itself never hard-deletes anything — duplicates are merged onto
 * the most complete/newest entry and every other side (the "losing"
 * duplicate and every stale entry) only moves to the Papierkorb, where it
 * stays recoverable.
 *
 * The computed preview is bound to the entry set it was computed from: when
 * the entries change (e.g. a history restore, or this panel's own apply),
 * the stored result is discarded and a fresh explicit click is required.
 */
export function VaultCleanupPanel({
  entries,
  onApply,
}: {
  entries: VaultEntry[];
  onApply: (
    run: CleanupRun,
    selectedKeys: ReadonlySet<string>,
  ) => Promise<CleanupApplyResult | CleanupApplyRejected>;
}): ReactNode {
  const { t } = useCopy();
  const [run, setRun] = useState<CleanupRun | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: "applied" | "stale"; text: string } | null>(null);
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });

  const preview = run && runMatchesEntries(run, entries) ? run.preview : null;
  const similar = preview
    ? preview.findings.filter((finding): finding is SimilarGroup => finding.kind === "similar")
    : [];
  const stale = preview
    ? preview.findings.filter((finding): finding is StaleFinding => finding.kind === "stale")
    : [];
  const selectedSimilar = similar.filter((group) => selectedKeys.has(cleanupFindingKey(group)));
  const selectedStale = stale.filter((finding) => selectedKeys.has(cleanupFindingKey(finding)));
  const hasSelection = selectedSimilar.length + selectedStale.length > 0;

  function runCheck(): void {
    const nextPreview = previewCleanup(entries);
    setRun({ entries, preview: nextPreview });
    setSelectedKeys(new Set(nextPreview.findings.map(cleanupFindingKey)));
    setNotice(null);
  }

  function closePreview(): void {
    setRun(null);
    setSelectedKeys(new Set());
    setNotice(null);
  }

  function toggleSelected(key: string): void {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleApply(): Promise<void> {
    if (!run || !hasSelection) return;
    setApplying(true);
    try {
      const result = await onApply(run, selectedKeys);
      if (result.ok) {
        setNotice({
          kind: "applied",
          text: t({
            de: `Übernommen: ${result.mergedGroups} Dublette(n) zusammengeführt, ${result.staleTrashed} veraltete Einträge in den Papierkorb verschoben.`,
            en: `Applied: ${result.mergedGroups} duplicate group(s) merged, ${result.staleTrashed} stale entries moved to trash.`,
          }),
        });
      } else {
        setNotice({
          kind: "stale",
          text: t({
            de: "Der Tresor hat sich seit der Prüfung verändert. Bitte erneut prüfen, bevor du übernimmst.",
            en: "The vault changed since the check. Please check again before applying.",
          }),
        });
      }
      // Either way the entries the old run was computed from are no longer
      // the live state the panel should show a selection for — force a
      // fresh, explicit click rather than keep a selection against stale data.
      setRun(null);
      setSelectedKeys(new Set());
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="card" data-testid="settings-cleanup">
      <h3>{t({ de: "Aufräumen", en: "Cleanup" })}</h3>
      <p className="hint">
        {t({
          de: "Zeigt Einträge, die sich ähnlich sehen, und Einträge, die lange nicht geändert wurden. Du wählst aus, was übernommen wird — nichts wird endgültig gelöscht, alles Verschobene bleibt im Papierkorb.",
          en: "Shows entries that look similar and entries unchanged for a long time. You choose what gets applied — nothing is ever deleted for good, anything moved stays in the trash.",
        })}
      </p>

      {notice ? (
        <p className={notice.kind === "stale" ? "muted" : "muted"} data-testid="cleanup-notice">
          {notice.text}
        </p>
      ) : null}

      {preview === null ? (
        <button type="button" className="primary" data-testid="cleanup-run" onClick={runCheck}>
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
          <button type="button" className="link" data-testid="cleanup-close" onClick={closePreview}>
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
                  de: "Diese Einträge teilen Adresse und Benutzer. Ausgewählte Gruppen werden zusammengeführt: die vollständigere/neuere Version bleibt, die andere wandert in den Papierkorb.",
                  en: "These entries share an address and user. Selected groups are merged: the more complete/newer version stays, the other moves to trash.",
                })}
              </p>
              <ul className="cleanup-list" data-testid="cleanup-similar">
                {similar.map((group) => {
                  const key = cleanupFindingKey(group);
                  return (
                    <li key={key}>
                      <label>
                        <input
                          type="checkbox"
                          data-testid={`cleanup-select-${key}`}
                          checked={selectedKeys.has(key)}
                          disabled={applying}
                          onChange={() => toggleSelected(key)}
                        />
                        <span className="muted">
                          {group.host}
                          {group.port ? `:${group.port}` : ""}
                          {" · "}
                          {group.identity}
                        </span>
                      </label>
                      {group.titles.map((title, index) => (
                        <div key={group.entryIds[index] ?? index}>
                          <strong>{title || untitled}</strong>
                          {index === 0 ? (
                            <span className="muted small"> {t({ de: "(bleibt)", en: "(kept)" })}</span>
                          ) : null}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {stale.length > 0 ? (
            <div>
              <h4>{t({ de: "Lange unverändert", en: "Long unchanged" })}</h4>
              <p className="hint">
                {t({
                  de: "Diese Einträge wurden lange nicht mehr geändert. Ausgewählte Einträge wandern in den Papierkorb — nicht endgültig gelöscht.",
                  en: "These entries have not been changed in a long time. Selected entries move to trash — not deleted for good.",
                })}
              </p>
              <ul className="cleanup-list" data-testid="cleanup-stale">
                {stale.map((finding) => {
                  const key = cleanupFindingKey(finding);
                  return (
                    <li key={key}>
                      <label>
                        <input
                          type="checkbox"
                          data-testid={`cleanup-select-${key}`}
                          checked={selectedKeys.has(key)}
                          disabled={applying}
                          onChange={() => toggleSelected(key)}
                        />
                        <strong>{finding.title || untitled}</strong>
                        <span className="muted"> · {formatAgeDays(finding.ageDays, t)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <p className="hint" data-testid="cleanup-summary">
            {hasSelection
              ? t({
                  de: `Übernehmen: ${selectedSimilar.length} Dublette(n) zusammenführen, ${selectedStale.length} veraltete Einträge in den Papierkorb.`,
                  en: `Apply: merge ${selectedSimilar.length} duplicate group(s), move ${selectedStale.length} stale entries to trash.`,
                })
              : t({ de: "Keine Änderung ausgewählt.", en: "No change selected." })}
          </p>
          <div className="device-actions">
            <button
              type="button"
              className="primary"
              data-testid="cleanup-apply"
              disabled={applying || !hasSelection}
              onClick={() => void handleApply()}
            >
              {t({ de: "Übernehmen", en: "Apply" })}
            </button>
            <button type="button" className="link" data-testid="cleanup-close" disabled={applying} onClick={closePreview}>
              {t({ de: "Schließen", en: "Close" })}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
