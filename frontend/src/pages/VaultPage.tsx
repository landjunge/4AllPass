import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";
import { demoGithubDraft } from "../lib/access-demo.ts";
import { autofillDemoDraft, isAutofillDemoEntry } from "../lib/autofill-demo.ts";
import { CLIPBOARD_CLEAR_MS, copySecret, readClipboardText } from "../lib/clipboard.ts";
import { detectCredential, draftFromDetection } from "../lib/detect.ts";
import { applyTemplate, BUILTIN_TEMPLATES, parseProviderTemplate } from "../lib/providers.ts";
import {
  emptyDraft,
  generatePassword,
  newEntryId,
  type EntryDraft,
  type VaultEntry,
} from "../lib/entries.ts";
import {
  entriesFromBrowserLogins,
  importReviewRows,
  mergeImportedLogins,
  parsePlaintextExport,
  plaintextImportWarning,
} from "../lib/import.ts";
import {
  buildSharePackage,
  downloadShareFile,
  looksLikeSharePackage,
  openSharePackage,
  shareWarning,
  type BuiltShare,
} from "../lib/share.ts";
import { parseOtpauth } from "../lib/totp.ts";
import { TotpCode } from "../components/TotpCode.tsx";
import { AccessBrokerHost } from "../components/AccessBrokerHost.tsx";
import { AccessPanel } from "../components/AccessPanel.tsx";
import { BrowserCards } from "../components/BrowserCards.tsx";
import { DevicesPanel } from "../components/DevicesPanel.tsx";
import { SettingsPanel } from "../components/SettingsPanel.tsx";

export function VaultPage(): ReactNode {
  const { vault, saveEntries } = useApp();
  const { t, plain } = useCopy();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"entries" | "devices" | "access" | "settings">("entries");
  const [importPending, setImportPending] = useState<{
    count: number;
    entries: VaultEntry[];
    source: "plaintext" | "share" | "browser";
    picked: string[];
  } | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [share, setShare] = useState<BuiltShare | null>(null);
  const [shareImport, setShareImport] = useState<{ text: string; key: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [customTemplate, setCustomTemplate] = useState("");

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
      credentialType: entry.credentialType,
      notes: entry.notes,
      totpSecret: entry.totpSecret,
      domain: entry.domain,
      providerId: entry.providerId,
      providerConfidence: entry.providerConfidence,
      providerMatchType: entry.providerMatchType,
    });
  }

  function applyDetect(text: string): void {
    const found = detectCredential(text);
    if (!found) {
      setDetectedLabel(
        "Nichts erkannt. Wähle Website, API oder SSH. / Nothing recognized. Pick Web, API, or SSH/SFTP.",
      );
      return;
    }
    setDraft({
      ...draftFromDetection(found),
      password: found.password || draft?.password || generatePassword(),
    });
    setDetectedLabel(
      `${found.label}. Speichern legt es in den Tresor. Programme bekommen es nicht automatisch. / Save stores it encrypted. Programs do not get it automatically.`,
    );
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
      setImportPending({
        count: parsed.entries.length,
        entries: parsed.entries,
        source: "plaintext",
        picked: parsed.entries.map((entry) => entry.id),
      });
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
      setImportPending({
        count: opened.length,
        entries: opened,
        source: "share",
        picked: opened.map((entry) => entry.id),
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmImport(): Promise<void> {
    if (!importPending || !vault) return;
    setBusy(true);
    try {
      const chosen = importPending.entries.filter((entry) => importPending.picked.includes(entry.id));
      if (chosen.length === 0) return;
      const next =
        importPending.source === "browser"
          ? mergeImportedLogins(entries, chosen)
          : [...entries, ...chosen];
      await saveEntries(next);
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
      <AccessBrokerHost entries={entries} />
      <nav className="tabs">
        <button
          type="button"
          className={tab === "entries" ? "active" : ""}
          onClick={() => setTab("entries")}
          data-testid="tab-entries"
        >
          {t({ de: "Einträge", en: "Entries" })} ({entries.length})
        </button>
        <button
          type="button"
          className={tab === "access" ? "active" : ""}
          onClick={() => setTab("access")}
          data-testid="tab-access"
        >
          {t({ de: "Programme", en: "Apps" })}
        </button>
        <button
          type="button"
          className={tab === "devices" ? "active" : ""}
          onClick={() => setTab("devices")}
          data-testid="tab-devices"
        >
          {t({ de: "Geräte", en: "Devices" })}
        </button>
        <button
          type="button"
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
          data-testid="tab-settings"
        >
          {t({ de: "Einstellungen", en: "Settings" })}
        </button>
        <span className={plain ? "sr-only" : "revision"} data-testid="revision">
          revision {vault.revision} · vault key v{vault.vaultKeyVersion}
        </span>
      </nav>

      {tab === "settings" ? (
        <SettingsPanel />
      ) : tab === "devices" ? (
        <DevicesPanel />
      ) : tab === "access" ? (
        <AccessPanel
          entries={entries}
          onSeedDemo={async () => {
            setBusy(true);
            try {
              await saveEntries([
                ...entries,
                {
                  id: newEntryId(),
                  ...demoGithubDraft(),
                  updatedAt: new Date().toISOString(),
                },
              ]);
            } catch {
              // The banner shows the reason.
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <>
        <BrowserCards
          vaultId={vault.vaultId}
          onLogins={(rows) => {
            const incoming = entriesFromBrowserLogins(rows);
            if (incoming.length === 0) {
              window.alert("Keine Passwörter gelesen. / No passwords read.");
              return;
            }
            setImportPending({
              count: incoming.length,
              entries: incoming,
              source: "browser",
              picked: incoming.map((entry) => entry.id),
            });
          }}
          onEnsureDemoLogin={async () => {
            if (entries.some(isAutofillDemoEntry)) return;
            await saveEntries([
              ...entries,
              {
                id: newEntryId(),
                ...autofillDemoDraft(),
                updatedAt: new Date().toISOString(),
              },
            ]);
          }}
        />
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
                        {entry.provider || entry.kind}
                        {entry.account ? ` / ${entry.account}` : ""}
                        {entry.credentialType ? ` / ${entry.credentialType}` : ` / ${entry.kind}`}
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
                <h3>{selectedId ? "Eintrag / Edit" : "Neuer Eintrag / New entry"}</h3>
                <p className="hint">
                  {t(
                    {
                      de: "Ein Klick liest die Zwischenablage einmal. Kein dauerndes Mitlesen. Speichern musst du selbst.",
                      en: "One click reads the clipboard once. No background watch. You still save.",
                    },
                    {
                      de: "Detect: ghp_/sk-/Stripe. Kein Clipboard-Watcher (#59). Prefill, kein Grant.",
                      en: "Detect: ghp_/sk-/Stripe. Not a clipboard watcher. Prefill, never a grant.",
                    },
                  )}
                </p>
                <label>
                  Einfügen / Paste
                  <textarea
                    rows={3}
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                    data-testid="detect-paste"
                    placeholder="ghp_… · sk-… · ftp.example.com · https://…"
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    data-testid="detect-clipboard"
                    onClick={() => {
                      void readClipboardText()
                        .then((text) => {
                          setPaste(text);
                          applyDetect(text);
                        })
                        .catch(() => {
                          setDetectedLabel(
                            "Zwischenablage nicht lesbar. Einfügen und Erkennen. / Clipboard blocked. Paste, then Detect.",
                          );
                        });
                    }}
                  >
                    Zwischenablage einmal lesen / Read clipboard once
                  </button>
                  <button
                    type="button"
                    data-testid="detect-apply"
                    onClick={() => applyDetect(paste)}
                  >
                    Eingefügtes erkennen / Detect paste
                  </button>
                </div>
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
                <p className="hint">Provider ≠ account ≠ credential. Templates stay on this device.</p>
                <div className="tabs">
                  {BUILTIN_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      data-testid={`template-${template.id}`}
                      onClick={() =>
                        setDraft({
                          ...applyTemplate(template, draft.account || "personal"),
                          password: draft.password || generatePassword(),
                        })
                      }
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
                <label>
                  Custom template
                  <textarea
                    rows={4}
                    value={customTemplate}
                    onChange={(event) => setCustomTemplate(event.target.value)}
                    data-testid="custom-template"
                    placeholder={"id: acme\nname: Acme\n  - widget.read"}
                  />
                </label>
                <button
                  type="button"
                  data-testid="apply-custom-template"
                  onClick={() => {
                    try {
                      const template = parseProviderTemplate(customTemplate);
                      setDraft({
                        ...applyTemplate(template, draft.account || "personal"),
                        password: draft.password || generatePassword(),
                      });
                      setDetectedLabel(`Template ${template.name}. Save encrypts it. Access still needs Allow.`);
                    } catch (error) {
                      setDetectedLabel(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  Apply custom template
                </button>
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
                  TOTP secret (Base32 / otpauth)
                  <input
                    type="password"
                    value={draft.totpSecret}
                    onChange={(event) => {
                      const value = event.target.value;
                      const parsed = parseOtpauth(value);
                      if (parsed) {
                        setDraft({
                          ...draft,
                          totpSecret: parsed.secret,
                          title: draft.title || parsed.issuer || parsed.account,
                          username: draft.username || parsed.account,
                        });
                        return;
                      }
                      setDraft({ ...draft, totpSecret: value });
                    }}
                    data-testid="entry-totp"
                    autoComplete="off"
                    placeholder="JBSWY… or otpauth://totp/…"
                  />
                </label>
                {draft.totpSecret.startsWith("otpauth:") ? (
                  <p className="hint">Paste into the box on the left of the vault, then save.</p>
                ) : draft.totpSecret ? (
                  <TotpCode secret={draft.totpSecret} />
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
                <h3>Dein Tresor / Your vault</h3>
                <p className="muted">
                  Oben die Browser-Karten: Profile anhaken, Passwörter holen, Extension laden, dann
                  Demo-Login öffnen. Popup: nur Tresor-Passwort. Wenn ein Programm wie n8n Zugang
                  will: Tab Programme. Nicht dieser Bildschirm.
                </p>
              </div>
            )}
          </section>
        </div>
        </>
      )}
      {importPending ? (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card kit">
            <h2>
              {importPending.source === "share"
                ? "Import shared logins"
                : importPending.source === "browser"
                  ? "Browser-Passwörter in den Tresor / Browser passwords into the vault"
                  : "Import plaintext file"}
            </h2>
            <p>
              {importPending.source === "share"
                ? "The share file is already decrypted on this device. Confirming encrypts the logins into your vault. The server only stores ciphertext."
                : importPending.source === "browser"
                  ? "Keychain hat freigegeben. Bestätigen verschlüsselt die Logins in deinen Tresor. Der Server sieht sie nicht. / Keychain granted. Confirm encrypts into your vault. The server never sees them."
                  : plaintextImportWarning()}
            </p>
            <div className="import-review" data-testid="import-review">
              <p className="muted">
                {t(
                  {
                    de: `${importPending.picked.length} / ${importPending.entries.length} gewählt. Keine Passwörter in dieser Liste.`,
                    en: `${importPending.picked.length} / ${importPending.entries.length} selected. No passwords in this list.`,
                  },
                )}
              </p>
              <div className="actions">
                <button
                  type="button"
                  onClick={() =>
                    setImportPending({
                      ...importPending,
                      picked: importPending.entries.map((entry) => entry.id),
                    })
                  }
                >
                  {t({ de: "Alle", en: "All" })}
                </button>
                <button
                  type="button"
                  onClick={() => setImportPending({ ...importPending, picked: [] })}
                >
                  {t({ de: "Keine", en: "None" })}
                </button>
              </div>
              <ul>
                {importReviewRows(importPending.entries).map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={importPending.picked.includes(row.id)}
                        onChange={() => {
                          const on = importPending.picked.includes(row.id);
                          setImportPending({
                            ...importPending,
                            picked: on
                              ? importPending.picked.filter((id) => id !== row.id)
                              : [...importPending.picked, row.id],
                          });
                        }}
                      />
                      <span>
                        <strong>{row.title || row.url}</strong>
                        <span className="muted">
                          {" "}
                          {row.username}
                          {row.provider
                            ? ` · ${row.provider}${row.confidence >= 0.95 ? "" : " ?"}`
                            : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={busy || importPending.picked.length === 0}
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
