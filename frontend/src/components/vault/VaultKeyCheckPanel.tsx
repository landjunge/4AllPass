import { useState, type ReactNode } from "react";
import { checkProviderKeys } from "../../modules/desktop-adapter/index.ts";
import {
  CHECKABLE_PROVIDERS,
  statusHint,
  statusLabel,
  suggestCheckableProvider,
  type CheckableProviderId,
  type ProviderKeyCheckRecord,
} from "../../lib/provider-key-check.ts";
import { useCopy } from "../../state/copy-mode.tsx";
import type { VaultEntry } from "../../types/vault.ts";
import { entryDisplayTitle } from "../../utils/vault/labels.ts";

/**
 * V8 — API-Schlüssel prüfen (issue #277).
 *
 * Every check is an explicit click: nothing here runs on mount, on a timer,
 * or because an entry was opened. The provider for each row is a dropdown
 * the user confirms (pre-filled only on an exact provider-name match, never
 * guessed from the key itself) — never a silent assignment. Results show
 * only provider, status, a short scope hint, and the moment checked; the
 * key value never appears here or anywhere downstream.
 */
export function VaultKeyCheckPanel({ entries }: { entries: VaultEntry[] }): ReactNode {
  const { t } = useCopy();
  const untitled = t({ de: "Ohne Titel", en: "Untitled" });
  const apiEntries = entries.filter((entry) => entry.kind === "api");

  const [picked, setPicked] = useState<Record<string, CheckableProviderId | "">>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ProviderKeyCheckRecord>>({});
  const [running, setRunning] = useState(false);

  const providerFor = (entry: VaultEntry): CheckableProviderId | "" =>
    picked[entry.id] ?? suggestCheckableProvider(entry.provider) ?? "";

  const checkable = apiEntries.filter((entry) => providerFor(entry) !== "" && entry.password.trim() !== "");

  async function runCheck(ids: string[]): Promise<void> {
    const items = ids
      .map((id) => apiEntries.find((entry) => entry.id === id))
      .filter((entry): entry is VaultEntry => entry !== undefined)
      .map((entry) => ({ id: entry.id, providerId: providerFor(entry) as string, key: entry.password }));
    if (items.length === 0) return;
    setRunning(true);
    try {
      const outcomes = await checkProviderKeys(items);
      const checkedAt = new Date().toISOString();
      setResults((prev) => {
        const next = { ...prev };
        for (const outcome of outcomes) next[outcome.id] = { ...outcome, checkedAt };
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  if (apiEntries.length === 0) {
    return (
      <section className="card" data-testid="settings-key-check">
        <h3>{t({ de: "API-Schlüssel prüfen", en: "Check API keys" })}</h3>
        <p className="muted" data-testid="key-check-empty">
          {t({ de: "Keine API-Key-Einträge im Tresor.", en: "No API key entries in the vault." })}
        </p>
      </section>
    );
  }

  return (
    <section className="card" data-testid="settings-key-check">
      <h3>{t({ de: "API-Schlüssel prüfen", en: "Check API keys" })}</h3>
      <p className="hint">
        {t({
          de: "Fragt nur den dokumentierten, kostenfreien Status-Endpunkt des gewählten Anbieters ab — direkt von diesem Gerät, nie über 4AllPass-Server, ChatGPT oder ein Protokoll. Der Schlüsselwert wird nie angezeigt. Das Ergebnis ist eine Momentaufnahme, keine Dauergarantie.",
          en: "Only calls the chosen provider's documented, free status endpoint — directly from this device, never through the 4AllPass server, ChatGPT, or a log. The key value is never shown. The result is a snapshot, not a standing guarantee.",
        })}
      </p>
      <ul className="cleanup-list" data-testid="key-check-list">
        {apiEntries.map((entry) => {
          const provider = providerFor(entry);
          const result = results[entry.id];
          return (
            <li key={entry.id} data-testid={`key-check-row-${entry.id}`}>
              <label className="key-check-select">
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  disabled={provider === "" || entry.password.trim() === ""}
                  data-testid={`key-check-pick-${entry.id}`}
                  onChange={(event) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(entry.id);
                      else next.delete(entry.id);
                      return next;
                    });
                  }}
                />
                <strong>{entryDisplayTitle(entry, untitled)}</strong>
              </label>
              <select
                value={provider}
                data-testid={`key-check-provider-${entry.id}`}
                onChange={(event) =>
                  setPicked((prev) => ({ ...prev, [entry.id]: event.target.value as CheckableProviderId | "" }))
                }
              >
                <option value="">{t({ de: "Anbieter wählen", en: "Choose provider" })}</option>
                {CHECKABLE_PROVIDERS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="link"
                data-testid={`key-check-run-${entry.id}`}
                disabled={provider === "" || entry.password.trim() === "" || running}
                onClick={() => void runCheck([entry.id])}
              >
                {t({ de: "Prüfen", en: "Check" })}
              </button>
              {result ? (
                <span className={`issue-pill key-check-status-${result.status}`} data-testid={`key-check-result-${entry.id}`}>
                  {statusLabel(result.status, t)}
                  {result.scopeHint ? ` · ${result.scopeHint}` : ""}
                  {" · "}
                  {new Date(result.checkedAt).toLocaleTimeString()}
                  {statusHint(result.status, t) ? <span className="hint"> {statusHint(result.status, t)}</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="primary"
        data-testid="key-check-run-selected"
        disabled={selected.size === 0 || running}
        onClick={() => void runCheck([...selected])}
      >
        {running
          ? t({ de: "Prüft …", en: "Checking …" })
          : t({ de: `Ausgewählte prüfen (${selected.size})`, en: `Check selected (${selected.size})` })}
      </button>
      {checkable.length === 0 ? (
        <p className="muted" data-testid="key-check-none-ready">
          {t({
            de: "Für keinen Eintrag ist ein unterstützter Anbieter gewählt oder ein Schlüssel vorhanden.",
            en: "No entry has a supported provider chosen and a key present.",
          })}
        </p>
      ) : null}
    </section>
  );
}
