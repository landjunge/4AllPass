import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import {
  emptyDraft,
  generatePassword,
  newEntryId,
  type EntryDraft,
  type VaultEntry,
} from "../lib/entries.ts";
import { DevicesPanel } from "../components/DevicesPanel.tsx";

export function VaultPage(): ReactNode {
  const { vault, saveEntries } = useApp();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"entries" | "devices">("entries");

  const entries = vault?.entries ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.username, entry.url].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [entries, query]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  function startNew(): void {
    setSelectedId(null);
    setDraft({ ...emptyDraft(), password: generatePassword() });
  }

  function startEdit(entry: VaultEntry): void {
    setSelectedId(entry.id);
    setDraft({
      title: entry.title,
      username: entry.username,
      password: entry.password,
      url: entry.url,
      notes: entry.notes,
    });
  }

  async function save(): Promise<void> {
    if (!draft || !vault) return;
    setBusy(true);
    const updatedAt = new Date().toISOString();
    const next: VaultEntry[] = selectedId
      ? entries.map((entry) => (entry.id === selectedId ? { ...entry, ...draft, updatedAt } : entry))
      : [...entries, { id: newEntryId(), ...draft, updatedAt }];
    try {
      await saveEntries(next);
      setDraft(null);
      setSelectedId(null);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: VaultEntry): Promise<void> {
    setBusy(true);
    try {
      await saveEntries(entries.filter((candidate) => candidate.id !== entry.id));
      setDraft(null);
      setSelectedId(null);
    } catch {
      // The banner shows the reason.
    } finally {
      setBusy(false);
    }
  }

  if (!vault) return null;

  return (
    <div className="vault">
      <nav className="tabs">
        <button
          type="button"
          className={tab === "entries" ? "active" : ""}
          onClick={() => setTab("entries")}
        >
          Entries ({entries.length})
        </button>
        <button
          type="button"
          className={tab === "devices" ? "active" : ""}
          onClick={() => setTab("devices")}
          data-testid="tab-devices"
        >
          Devices
        </button>
        <span className="revision" data-testid="revision">
          revision {vault.revision} · vault key v{vault.vaultKeyVersion}
        </span>
      </nav>

      {tab === "devices" ? (
        <DevicesPanel />
      ) : (
        <div className="columns">
          <section className="card list">
            <div className="list-header">
              <input
                type="search"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" onClick={startNew} data-testid="new-entry">
                New
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="muted empty">No entries yet.</p>
            ) : (
              <ul>
                {filtered.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={entry.id === selectedId ? "row active" : "row"}
                      onClick={() => startEdit(entry)}
                    >
                      <strong>{entry.title || "(untitled)"}</strong>
                      <span className="muted">{entry.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card detail">
            {draft ? (
              <>
                <h3>{selectedId ? "Edit entry" : "New entry"}</h3>
                <label>
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    data-testid="entry-title"
                  />
                </label>
                <label>
                  Username
                  <input
                    value={draft.username}
                    onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                    data-testid="entry-username"
                  />
                </label>
                <label>
                  Password
                  <input
                    value={draft.password}
                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                    data-testid="entry-password"
                  />
                </label>
                <button
                  type="button"
                  className="link"
                  onClick={() => setDraft({ ...draft, password: generatePassword() })}
                >
                  Generate password
                </button>
                <label>
                  URL
                  <input
                    value={draft.url}
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    rows={4}
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void save()}
                    disabled={busy}
                    data-testid="save-entry"
                  >
                    {busy ? "Committing…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setDraft(null)} disabled={busy}>
                    Cancel
                  </button>
                  {selected ? (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void remove(selected)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="placeholder">
                <h3>Zero-knowledge vault</h3>
                <p className="muted">
                  Select an entry or create a new one. Saving re-seals every entry with a fresh
                  nonce and commits the next revision.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
