import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { CLIPBOARD_CLEAR_MS, copySecret } from "../lib/clipboard.ts";
import { detectCredential, draftFromDetection } from "../lib/detect.ts";
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
import { AccessPanel } from "../components/AccessPanel.tsx";
import { DevicesPanel } from "../components/DevicesPanel.tsx";

export function VaultPage(): ReactNode {
  const { vault, saveEntries } = useApp();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"entries" | "devices" | "access">("entries");
  const [importPending, setImportPending] = useState<{
    count: number;
    entries: VaultEntry[];
    source: "plaintext" | "share";
  } | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [share, setShare] = useState<BuiltShare | null>(null);
  const [shareImport, setShareImport] = useState<{ text: string; key: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);

  useEffect(() => {
    setRevealPassword(false);
    setCopied(null);
  }, [selectedId]);

  const entries = vault?.entries ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.username, entry.url, entry.provider, entry.host].some((field) =>
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
    setDraft({ ...emptyDraft("web"), password: generatePassword() });
  }

  function startEdit(entry: VaultEntry): void {
    setSelectedId(entry.id);
    setDraft({
      kind: entry.kind,
      title: entry.title,
      provider: entry.provider,
      account: entry.account,
      username: entry.username,
      password: entry.password,
      url: entry.url,
      host: entry.host,
      port: entry.port,
      protocol: entry.protocol,
      capabilities: entry.capabilities,
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
      setPaste("");
      setDetectedLabel(null);
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
          data-testid="tab-entries"
        >
          Entries ({entries.length})
        </button>
        <button
          type="button"
          className={tab === "access" ? "active" : ""}
          onClick={() => setTab("access")}
          data-testid="tab-access"
        >
          Access
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
      ) : tab === "access" ? (
        <AccessPanel entries={entries} />
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
                      <span className="muted">
                        {entry.kind}
                        {entry.provider ? ` · ${entry.provider}` : ""}
                        {entry.username ? ` · ${entry.username}` : ""}
                      </span>
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
                  Paste credential
                  <textarea
                    rows={3}
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                    data-testid="detect-paste"
                    placeholder="ghp_… or ftp.example.com / https://…"
                  />
                </label>
                <p className="hint">Detect fills the form. It never grants access.</p>
                <button
                  type="button"
                  data-testid="detect-apply"
                  onClick={() => {
                    const found = detectCredential(paste);
                    if (!found) {
                      setDetectedLabel("Nothing recognized. Pick Web, API, or SSH/SFTP.");
                      return;
                    }
                    setDraft({
                      ...draftFromDetection(found),
                      password: found.password || draft?.password || generatePassword(),
                    });
                    setPaste("");
                    setDetectedLabel(`${found.label}. Save to store it encrypted. Access still needs Allow.`);
                  }}
                >
                  Detect
                </button>
                {detectedLabel ? (
                  <p className="ok" data-testid="detect-label">
                    {detectedLabel}
                  </p>
                ) : null}
                <div className="tabs">
                  {(["web", "api", "sftp"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={draft.kind === kind ? "active" : ""}
                      data-testid={`kind-${kind}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          kind,
                          port: kind === "sftp" && !draft.port ? "22" : draft.port,
                          protocol: kind === "sftp" && !draft.protocol ? "sftp" : draft.protocol,
                          capabilities:
                            kind === "api" && !draft.capabilities
                              ? "repository.read"
                              : draft.capabilities,
                        })
                      }
                    >
                      {kind === "web" ? "Web" : kind === "api" ? "API" : "SSH/SFTP"}
                    </button>
                  ))}
                </div>
                <label>
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    data-testid="entry-title"
                  />
                </label>
                <label>
                  Provider
                  <input
                    value={draft.provider}
                    onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
                    data-testid="entry-provider"
                    placeholder={draft.kind === "api" ? "GitHub" : draft.kind === "sftp" ? "Production" : ""}
                  />
                </label>
                <label>
                  Account
                  <input
                    value={draft.account}
                    onChange={(event) => setDraft({ ...draft, account: event.target.value })}
                    data-testid="entry-account"
                    placeholder="personal"
                  />
                </label>
                {draft.kind === "sftp" ? (
                  <>
                    <label>
                      Host
                      <input
                        value={draft.host}
                        onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                        data-testid="entry-host"
                      />
                    </label>
                    <label>
                      Protocol
                      <input
                        value={draft.protocol}
                        onChange={(event) => setDraft({ ...draft, protocol: event.target.value })}
                      />
                    </label>
                    <label>
                      Port
                      <input
                        value={draft.port}
                        onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}
                {draft.kind === "api" ? (
                  <label>
                    Capabilities
                    <input
                      value={draft.capabilities}
                      onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })}
                      data-testid="entry-capabilities"
                      placeholder="repository.read"
                    />
                  </label>
                ) : null}
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
                  {draft.kind === "api" ? "API key / token" : "Password"}
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
                  Web, API, or SSH/SFTP. Saving re-seals every entry on this device. The server only
                  stores ciphertext. Agent access is the Access tab — unknown apps are denied.
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
