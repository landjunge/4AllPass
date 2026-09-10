import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type VaultRevisionSummary } from "../../lib/api.ts";
import { decodeVaultSnapshot } from "@4allpass/crypto";
import { HistoricRevisionUnreadable, openHistoricEntries } from "../../lib/vault-session.ts";
import { useApp } from "../../state/app-state.tsx";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";

function formatWhen(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * V7.3 — Frühere Stände. One question: what was in the vault before?
 *
 * Opening an older state never rewinds anything: restoring writes the
 * recovered entries forward as a new state, and the state that was live stays
 * stored like every other one.
 */
export function VaultHistoryPanel(): ReactNode {
  const { t } = useCopy();
  const { vault, saveEntries } = useApp();
  const [revisions, setRevisions] = useState<VaultRevisionSummary[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [preview, setPreview] = useState<VaultEntry[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const vaultId = vault?.vaultId ?? null;

  const load = useCallback(async () => {
    if (!vaultId) return;
    setRevisions(await api.listRevisions(vaultId));
  }, [vaultId]);

  useEffect(() => {
    void load().catch(() => setRevisions([]));
  }, [load]);

  async function show(revision: number): Promise<void> {
    if (!vault) return;
    setBusy(true);
    setOpen(revision);
    setPreview(null);
    setUnreadable(false);
    try {
      const wire = await api.getRevision(vault.vaultId, revision);
      setPreview(openHistoricEntries(decodeVaultSnapshot(wire), vault));
    } catch (error) {
      if (error instanceof HistoricRevisionUnreadable) setUnreadable(true);
      else setOpen(null);
    } finally {
      setBusy(false);
    }
  }

  async function restore(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    try {
      await saveEntries(preview);
      setOpen(null);
      setPreview(null);
      await load();
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  if (!vault) return null;

  const older = (revisions ?? []).filter((row) => !row.isActive);

  return (
    <section className="card" data-testid="settings-history">
      <h3>{t({ de: "Frühere Stände", en: "Earlier states" })}</h3>
      <p className="hint">
        {t({
          de: "Was vorher im Tresor war. Wiederherstellen legt einen neuen Stand an — nichts wird zurückgedreht und nichts gelöscht.",
          en: "What the vault held before. Restoring writes a new state — nothing is rewound and nothing is deleted.",
        })}
      </p>

      {revisions === null ? (
        <p className="muted">{t({ de: "Wird geladen…", en: "Loading…" })}</p>
      ) : older.length === 0 ? (
        <p className="muted" data-testid="history-empty">
          {t({
            de: "Noch keine früheren Stände. Sobald du etwas änderst, steht der vorherige Stand hier.",
            en: "No earlier states yet. As soon as you change something, the previous state appears here.",
          })}
        </p>
      ) : (
        <ul className="history-list" data-testid="history-list">
          {older.map((row) => (
            <li key={row.revision}>
              <button
                type="button"
                className="link"
                data-testid={`history-open-${String(row.revision)}`}
                disabled={busy}
                onClick={() => void show(row.revision)}
              >
                {formatWhen(row.createdAt)}
                {" · "}
                {row.entryCount === 1
                  ? t({ de: "1 Eintrag", en: "1 entry" })
                  : t(
                      { de: `${String(row.entryCount)} Einträge`, en: `${String(row.entryCount)} entries` },
                    )}
                {row.vaultKeyVersion !== vault.vaultKeyVersion
                  ? ` · ${t({ de: "vor dem Schlüsselwechsel", en: "before the key change" })}`
                  : ""}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card">
            <h3>{t({ de: "Dieser frühere Stand", en: "This earlier state" })}</h3>
            {unreadable ? (
              <>
                <p data-testid="history-unreadable">
                  {t({
                    de: "Dieser Stand ist von vor einem Schlüsselwechsel. Der jetzige Tresor-Schlüssel passt nicht darauf, deshalb lässt er sich nicht mehr öffnen.",
                    en: "This state is from before a key change. The current vault key does not fit it, so it can no longer be opened.",
                  })}
                </p>
                <button type="button" className="primary" onClick={() => setOpen(null)}>
                  {t({ de: "Schließen", en: "Close" })}
                </button>
              </>
            ) : preview === null ? (
              <p className="muted">{t({ de: "Wird geöffnet…", en: "Opening…" })}</p>
            ) : (
              <>
                <p className="hint">
                  {t({
                    de: "Namen und Benutzer dieses Standes. Passwörter zeigt diese Liste nie.",
                    en: "Names and usernames in this state. This list never shows passwords.",
                  })}
                </p>
                <ul className="history-preview" data-testid="history-preview">
                  {preview.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.title}</strong>
                      {entry.username ? <span className="muted"> · {entry.username}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="hint">
                  {t({
                    de: "Wiederherstellen ersetzt den jetzigen Inhalt durch diesen. Der jetzige Stand bleibt hier weiter aufgehoben.",
                    en: "Restoring replaces the current content with this one. The current state stays kept here too.",
                  })}
                </p>
                <button
                  type="button"
                  className="primary"
                  data-testid="history-restore"
                  disabled={busy}
                  onClick={() => void restore()}
                >
                  {t({ de: "Diesen Stand wiederherstellen", en: "Restore this state" })}
                </button>
                <button
                  type="button"
                  className="link"
                  data-testid="history-cancel"
                  onClick={() => setOpen(null)}
                >
                  {t({ de: "Abbrechen", en: "Cancel" })}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
