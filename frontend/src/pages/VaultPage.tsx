import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { CLIPBOARD_CLEAR_MS, copySecret } from "../lib/clipboard.ts";
import {
  emptyDraft,
  generatePassword,
  newEntryId,
  type EntryDraft,
  type VaultEntry,
} from "../lib/entries.ts";
import { parsePlaintextExport, plaintextImportWarning } from "../lib/import.ts";
import {
  buildSharePackage,
  downloadShareFile,
  looksLikeSharePackage,
  openSharePackage,
  shareWarning,
  type BuiltShare,
} from "../lib/share.ts";
import { DevicesPanel } from "../components/DevicesPanel.tsx";

export function VaultPage(): ReactNode {
  const { vault, saveEntries } = useApp();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"entries" | "devices">("entries");
  const [importPending, setImportPending] = useState<{
    count: number;
    entries: VaultEntry[];
    source: "plaintext" | "share";
  } | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [share, setShare] = useState<BuiltShare | null>(null);
  const [shareImport, setShareImport] = useState<{ text: string; key: string } | null>(null);

  useEffect(() => {
    setRevealPassword(false);
    setCopied(null);
  }, [selectedId]);

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

  function copyField(label: string, value: string): void {
    void copySecret(value)
      .then(() => setCopied(label))
      .catch(() => setCopied(null));
  }

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

  async function onImportFile(file: File): Promise<void> {
    const text = await file.text();
    try {
      if (looksLikeSharePackage(text)) {
        setShareImport({ text, key: "" });
        return;
      }
      const parsed = parsePlaintextExport(text);
      if (parsed.entries.length === 0) throw new Error("no login entries in this file");
      setImportPending({ count: parsed.entries.length, entries: parsed.entries, source: "plaintext" });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function startShare(): void {
    if (!selected) return;
    try {
      setShare(buildSharePackage([selected]));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function openShare(): void {
    if (!shareImport) return;
    try {
      const opened = openSharePackage(shareImport.text, shareImport.key);
      if (opened.length === 0) throw new Error("share file had no logins");
      setShareImport(null);
      setImportPending({ count: opened.length, entries: opened, source: "share" });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importPending || !vault) return;
    setBusy(true);
    try {
      await saveEntries([...entries, ...importPending.entries]);
      setImportPending(null);
    } catch {
      // banner
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
              <label className="import-file">
                Import
                <input
                  type="file"
                  accept=".json,.csv,.xml,.1pif,application/json,text/csv,application/xml,text/xml"
                  data-testid="import-file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void onImportFile(file);
                  }}
                />
              </label>
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
                    autoComplete="off"
                  />
                </label>
                <div className="field-actions">
                  <button
                    type="button"
                    className="link"
                    disabled={!draft.username}
                    data-testid="copy-username"
                    onClick={() => copyField("Username", draft.username)}
                  >
                    Copy username
                  </button>
                </div>
                <label>
                  Password
                  <input
                    type={revealPassword ? "text" : "password"}
                    value={draft.password}
                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                    data-testid="entry-password"
                    autoComplete="off"
                  />
                </label>
                <div className="field-actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setRevealPassword((open) => !open)}
                    data-testid="reveal-password"
                  >
                    {revealPassword ? "Hide password" : "Show password"}
                  </button>
                  <button
                    type="button"
                    className="link"
                    disabled={!draft.password}
                    data-testid="copy-password"
                    onClick={() => copyField("Password", draft.password)}
                  >
                    Copy password
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setDraft({ ...draft, password: generatePassword() })}
                  >
                    Generate password
                  </button>
                </div>
                {copied ? (
                  <p className="hint" data-testid="copied-note">
                    {copied} copied. The clipboard is overwritten in {CLIPBOARD_CLEAR_MS / 1000}{" "}
                    seconds if it still holds this value.
                  </p>
                ) : null}
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
                    <>
                      <button
                        type="button"
                        data-testid="share-entry"
                        onClick={startShare}
                        disabled={busy}
                      >
                        Share
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void remove(selected)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </>
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
      {importPending ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>{importPending.source === "share" ? "Import shared logins" : "Import plaintext file"}</h2>
            <p>
              {importPending.source === "share"
                ? "The share file is already decrypted on this device. Confirming encrypts the logins into your vault. The server only stores ciphertext."
                : plaintextImportWarning()}
            </p>
            <p className="muted">
              {importPending.count} login{importPending.count === 1 ? "" : "s"} will be encrypted on
              this device, then committed as the next revision.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                data-testid="confirm-import"
                onClick={() => void confirmImport()}
              >
                Encrypt and import
              </button>
              <button type="button" disabled={busy} onClick={() => setImportPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {share ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>Share this login</h2>
            <p>{shareWarning()}</p>
            <p className="muted small">Share key</p>
            <code className="mono block key" data-testid="share-key">
              {share.shareKey}
            </code>
            <div className="device-actions">
              <button
                type="button"
                className="primary"
                data-testid="download-share"
                onClick={() => downloadShareFile(share)}
              >
                Download encrypted file
              </button>
              <button
                type="button"
                onClick={() => {
                  void copySecret(share.shareKey)
                    .then(() => setCopied("Share key"))
                    .catch(() => undefined);
                }}
              >
                Copy share key
              </button>
            </div>
            {copied === "Share key" ? (
              <p className="hint">
                Key copied. The clipboard is overwritten in {CLIPBOARD_CLEAR_MS / 1000} seconds if it
                still holds this value.
              </p>
            ) : null}
            <button type="button" className="link" onClick={() => setShare(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}
      {shareImport ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>Open share file</h2>
            <p>Enter the share key. Decryption stays on this device.</p>
            <label>
              Share key
              <input
                value={shareImport.key}
                onChange={(event) => setShareImport({ ...shareImport, key: event.target.value })}
                data-testid="share-import-key"
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="primary"
                data-testid="open-share"
                onClick={openShare}
                disabled={!shareImport.key.trim()}
              >
                Decrypt on this device
              </button>
              <button type="button" onClick={() => setShareImport(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
