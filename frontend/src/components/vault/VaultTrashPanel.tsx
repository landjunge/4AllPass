import { useState, type ReactNode } from "react";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";

/**
 * P0 #279 "Papierkorb". Trashed entries stay client-side encrypted and part
 * of the committed, sealed snapshot — this panel only shows/restores/purges
 * them; it never touches history or sync directly. One question per action:
 * restore brings the entry back, purge is the conscious, final step that
 * actually removes it (a second explicit confirm, never a single click).
 */
export function VaultTrashPanel({
  entries,
  busy,
  retentionDays,
  onRestore,
  onPurge,
  onRetentionDaysChange,
}: {
  entries: VaultEntry[];
  busy: boolean;
  retentionDays: number | null;
  onRestore: (entry: VaultEntry) => void;
  onPurge: (entry: VaultEntry) => void;
  onRetentionDaysChange: (days: number | null) => void;
}): ReactNode {
  const { t } = useCopy();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [retentionInput, setRetentionInput] = useState(retentionDays != null ? String(retentionDays) : "");
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });

  function formatWhen(iso: string): string {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return iso;
    return when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function applyRetention(): void {
    const trimmed = retentionInput.trim();
    if (trimmed === "") {
      onRetentionDaysChange(null);
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    onRetentionDaysChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }

  return (
    <section className="card" data-testid="settings-trash">
      <h3>{t({ de: "Papierkorb", en: "Trash" })}</h3>
      <p className="hint">
        {t({
          de: "Gelöschte Einträge bleiben hier verschlüsselt, bis du sie wiederherstellst oder endgültig löschst.",
          en: "Deleted entries stay here, encrypted, until you restore them or delete them for good.",
        })}
      </p>

      {entries.length === 0 ? (
        <p className="muted" data-testid="trash-empty">
          {t({ de: "Der Papierkorb ist leer.", en: "The trash is empty." })}
        </p>
      ) : (
        <ul className="history-list" data-testid="trash-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="history-entry-line">
                <strong>{entry.title || untitled}</strong>
                {entry.host || entry.domain ? (
                  <span className="muted"> · {entry.host || entry.domain}</span>
                ) : null}
                {entry.deletedAt ? (
                  <span className="muted small">
                    {" · "}
                    {t({ de: "gelöscht ", en: "deleted " })}
                    {formatWhen(entry.deletedAt)}
                  </span>
                ) : null}
              </span>
              {confirmId === entry.id ? (
                <span className="device-actions">
                  <span className="muted small" data-testid={`trash-confirm-text-${entry.id}`}>
                    {t({
                      de: "Endgültig löschen — nicht mehr wiederherstellbar.",
                      en: "Delete for good — cannot be restored afterwards.",
                    })}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    data-testid={`trash-purge-confirm-${entry.id}`}
                    disabled={busy}
                    onClick={() => {
                      onPurge(entry);
                      setConfirmId(null);
                    }}
                  >
                    {t({ de: "Ja, endgültig löschen", en: "Yes, delete for good" })}
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={() => setConfirmId(null)}
                  >
                    {t({ de: "Abbrechen", en: "Cancel" })}
                  </button>
                </span>
              ) : (
                <span className="device-actions">
                  <button
                    type="button"
                    className="link"
                    data-testid={`trash-restore-${entry.id}`}
                    disabled={busy}
                    onClick={() => onRestore(entry)}
                  >
                    {t({ de: "Wiederherstellen", en: "Restore" })}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    data-testid={`trash-purge-${entry.id}`}
                    disabled={busy}
                    onClick={() => setConfirmId(entry.id)}
                  >
                    {t({ de: "Endgültig löschen", en: "Delete for good" })}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h4>{t({ de: "Aufbewahrungsfrist", en: "Retention" })}</h4>
      <p className="hint">
        {t({
          de: "Optional: gelöschte Einträge nach dieser Anzahl Tage automatisch endgültig löschen. Leer lassen für nie.",
          en: "Optional: automatically delete trashed entries for good after this many days. Leave empty for never.",
        })}
      </p>
      <label>
        {t({ de: "Tage (leer = nie)", en: "Days (empty = never)" })}
        <input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={retentionInput}
          data-testid="trash-retention-days"
          onChange={(event) => setRetentionInput(event.target.value)}
          onBlur={applyRetention}
        />
      </label>
      <button type="button" className="link" data-testid="trash-retention-save" onClick={applyRetention}>
        {t({ de: "Übernehmen", en: "Apply" })}
      </button>
    </section>
  );
}
