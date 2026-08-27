import type { ReactNode } from "react";
import { TotpCode } from "../TotpCode.tsx";
import { BUILTIN_TEMPLATES } from "../../lib/providers.ts";
import { useCopy } from "../../state/copy-mode.tsx";
import type { EntryDraft, EntryKind, Translate, VaultEntry } from "../../types/vault.ts";
import { applyKindToDraft, applyTotpInput } from "../../utils/vault/drafts.ts";
import { kindLabel, newEntryHeading } from "../../utils/vault/labels.ts";

function FieldLabel({ text, tip }: { text: string; tip: string }): ReactNode {
  return (
    <span className="field-label">
      {text}
      <span className="tip" title={tip} aria-label={tip}>
        ?
      </span>
    </span>
  );
}

export function VaultDetailEmpty({ onAdd }: { onAdd: (kind?: EntryKind) => void }): ReactNode {
  const { t } = useCopy();
  return (
    <div className="placeholder vault-detail-empty" data-testid="vault-detail-empty">
      <div className="empty-mark" aria-hidden="true" />
      <h3>{t({ de: "Welchen Zugang suche ich?", en: "Which login am I looking for?" })}</h3>
      <p className="muted">
        {t({
          de: "Links die Liste. Login, API-Key oder Server-Zugang rechts öffnen.",
          en: "List on the left. Open a login, API key, or server login on the right.",
        })}
      </p>
      <p className="hint">
        {t({
          de: "Oder direkt einen neuen Eintrag anlegen — verschlüsselt auf diesem Gerät.",
          en: "Or create a new entry — encrypted on this device.",
        })}
      </p>
      <div className="empty-actions">
        <button
          type="button"
          className="empty-action primary"
          onClick={() => onAdd("web")}
          title={t({ de: "Website-Login mit Benutzername und Passwort", en: "Website login with username and password" })}
        >
          <strong>{t({ de: "Login", en: "Login" })}</strong>
          <span>
            {t({
              de: "Website mit Benutzername und Passwort",
              en: "Website with username and password",
            })}
          </span>
        </button>
        <button
          type="button"
          className="empty-action"
          onClick={() => onAdd("api")}
          title={t({ de: "Token oder API-Key", en: "Token or API key" })}
        >
          <strong>{t({ de: "API-Key", en: "API key" })}</strong>
          <span>{t({ de: "Token für Programme. Erlauben bleibt nötig.", en: "Token for programs. Allow is still required." })}</span>
        </button>
        <button
          type="button"
          className="empty-action"
          onClick={() => onAdd("sftp")}
          title={t({ de: "SSH, SFTP oder FTP", en: "SSH, SFTP, or FTP" })}
        >
          <strong>{t({ de: "Server-Zugang", en: "Server login" })}</strong>
          <span>{t({ de: "Host, Protokoll und Port", en: "Host, protocol, and port" })}</span>
        </button>
      </div>
    </div>
  );
}

export function VaultEntryForm({
  draft,
  selected,
  selectedId,
  busy,
  showMore,
  revealPassword,
  copied,
  paste,
  detectedLabel,
  customTemplate,
  clipboardClearSeconds,
  onChange,
  onShowMoreChange,
  onToggleReveal,
  onCopyField,
  onPasteChange,
  onDetectClipboard,
  onDetectApply,
  onCustomTemplateChange,
  onApplyCustomTemplate,
  onApplyBuiltinTemplate,
  onSave,
  onCancel,
  onShare,
  onRemove,
  onGeneratePassword,
}: {
  draft: EntryDraft;
  selected: VaultEntry | null;
  selectedId: string | null;
  busy: boolean;
  showMore: boolean;
  revealPassword: boolean;
  copied: string | null;
  paste: string;
  detectedLabel: string | null;
  customTemplate: string;
  clipboardClearSeconds: number;
  onChange: (draft: EntryDraft) => void;
  onShowMoreChange: (open: boolean) => void;
  onToggleReveal: () => void;
  onCopyField: (label: string, value: string) => void;
  onPasteChange: (value: string) => void;
  onDetectClipboard: () => void;
  onDetectApply: () => void;
  onCustomTemplateChange: (value: string) => void;
  onApplyCustomTemplate: () => void;
  onApplyBuiltinTemplate: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onShare: () => void;
  onRemove: () => void;
  onGeneratePassword: () => void;
}): ReactNode {
  const { t } = useCopy();
  return (
    <>
      <h3>{selectedId ? kindLabel(draft.kind, t) : newEntryHeading(draft.kind, t)}</h3>
      <div className="tabs" role="tablist" aria-label={t({ de: "Art des Zugangs", en: "Entry type" })}>
        {(["web", "api", "sftp"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={draft.kind === kind ? "active" : ""}
            data-testid={`kind-${kind}`}
            title={kindTip(kind, t)}
            onClick={() => onChange(applyKindToDraft(draft, kind))}
          >
            {kindLabel(kind, t)}
          </button>
        ))}
      </div>
      <label>
        <FieldLabel
          text={t({ de: "Name", en: "Name" })}
          tip={t({
            de: "Wie der Eintrag in der Liste heißt. Nur auf diesem Gerät lesbar.",
            en: "How this entry appears in the list. Readable only on this device.",
          })}
        />
        <input
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          data-testid="entry-title"
          placeholder={titlePlaceholder(draft.kind, t)}
          autoComplete="off"
        />
      </label>
      {draft.kind === "web" ? (
        <label>
          <FieldLabel
            text="URL"
            tip={t({
              de: "Adresse der Website. Wird für Autofill und Import-Zuordnung genutzt.",
              en: "Website address. Used for autofill and import matching.",
            })}
          />
          <input
            value={draft.url}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
            placeholder="https://"
          />
        </label>
      ) : null}
      {draft.kind === "sftp" ? (
        <>
          <label>
            <FieldLabel
              text="Host"
              tip={t({ de: "Hostname oder IP des Servers.", en: "Server hostname or IP." })}
            />
            <input
              value={draft.host}
              onChange={(event) => onChange({ ...draft, host: event.target.value })}
              data-testid="entry-host"
              placeholder="ftp.example.com"
              autoComplete="off"
            />
          </label>
          <label>
            <FieldLabel
              text={t({ de: "Protokoll", en: "Protocol" })}
              tip={t({ de: "sftp, ssh oder ftp.", en: "sftp, ssh, or ftp." })}
            />
            <input
              value={draft.protocol}
              onChange={(event) => onChange({ ...draft, protocol: event.target.value })}
              placeholder="sftp"
            />
          </label>
          <label>
            <FieldLabel text="Port" tip={t({ de: "Standard für SFTP ist 22.", en: "SFTP default is 22." })} />
            <input
              value={draft.port}
              onChange={(event) => onChange({ ...draft, port: event.target.value })}
              placeholder="22"
            />
          </label>
        </>
      ) : null}
      <label>
        <FieldLabel
          text={
            draft.kind === "api"
              ? t({ de: "Kennung (optional)", en: "Id (optional)" })
              : t({ de: "Benutzername", en: "Username" })}
          tip={
            draft.kind === "api"
              ? t({ de: "Optionale Kennung, kein Geheimnis.", en: "Optional identifier, not a secret." })
              : t({ de: "Benutzername oder E-Mail für diesen Login.", en: "Username or email for this login." })
          }
        />
        <input
          value={draft.username}
          onChange={(event) => onChange({ ...draft, username: event.target.value })}
          data-testid="entry-username"
          autoComplete="off"
          placeholder={
            draft.kind === "api"
              ? t({ de: "optional", en: "optional" })
              : "ada@example.com"
          }
        />
      </label>
      <div className="field-actions">
        <button
          type="button"
          className="link"
          disabled={!draft.username}
          data-testid="copy-username"
          title={t({ de: "Benutzername in die Zwischenablage. Wird nach 30 s überschrieben.", en: "Copy username. Clipboard is overwritten after 30s." })}
          onClick={() => onCopyField(t({ de: "Benutzername", en: "Username" }), draft.username)}
        >
          {t({ de: "Benutzername kopieren", en: "Copy username" })}
        </button>
      </div>
      <label>
        <FieldLabel
          text={
            draft.kind === "api"
              ? t({ de: "API-Key / Token", en: "API key / token" })
              : t({ de: "Passwort", en: "Password" })}
          tip={t({
            de: "Geheimnis. Bleibt auf diesem Gerät, bis du den Tresor sperrst.",
            en: "Secret. Stays on this device until you lock the vault.",
          })}
        />
        <input
          type={revealPassword ? "text" : "password"}
          value={draft.password}
          onChange={(event) => onChange({ ...draft, password: event.target.value })}
          data-testid="entry-password"
          autoComplete="off"
          placeholder={
            draft.kind === "api"
              ? t({ de: "Token einfügen", en: "Paste token" })
              : t({ de: "Passwort oder erzeugen", en: "Password or generate" })
          }
        />
      </label>
      <div className="field-actions">
        <button
          type="button"
          className="link"
          onClick={onToggleReveal}
          data-testid="reveal-password"
          title={
            revealPassword
              ? t({ de: "Geheimnis wieder verbergen", en: "Hide the secret again" })
              : t({ de: "Geheimnis auf dem Bildschirm zeigen", en: "Show the secret on screen" })
          }
        >
          {revealPassword
            ? t({ de: "Verbergen", en: "Hide" })
            : t({ de: "Anzeigen", en: "Show" })}
        </button>
        <button
          type="button"
          className="link"
          disabled={!draft.password}
          data-testid="copy-password"
          title={t({
            de: "Kopiert das Geheimnis. Die Zwischenablage wird überschrieben, wenn sie den Wert noch hält.",
            en: "Copies the secret. The clipboard is overwritten if it still holds this value.",
          })}
          onClick={() => onCopyField(t({ de: "Passwort", en: "Password" }), draft.password)}
        >
          {t({ de: "Kopieren", en: "Copy" })}
        </button>
        {draft.kind !== "api" ? (
          <button
            type="button"
            className="link"
            onClick={onGeneratePassword}
            title={t({ de: "Zufälliges starkes Passwort einsetzen", en: "Insert a random strong password" })}
          >
            {t({ de: "Passwort erzeugen", en: "Generate password" })}
          </button>
        ) : null}
      </div>
      {copied ? (
        <p className="hint" data-testid="copied-note">
          {t({
            de: `${copied} kopiert. Die Zwischenablage wird in ${clipboardClearSeconds} Sekunden überschrieben, wenn sie den Wert noch hält.`,
            en: `${copied} copied. The clipboard is overwritten in ${clipboardClearSeconds} seconds if it still holds this value.`,
          })}
        </p>
      ) : null}
      <label>
        <FieldLabel
          text={t({ de: "Notiz", en: "Note" })}
          tip={t({
            de: "Freitext, mit dem Eintrag verschlüsselt. Kein automatischer Zugriff für Programme.",
            en: "Free text, encrypted with the entry. Programs do not get it automatically.",
          })}
        />
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          placeholder={t({
            de: "Optional. Nur nach dem Entsperren lesbar.",
            en: "Optional. Readable only after unlock.",
          })}
        />
      </label>
      <details
        className="more-options"
        open={showMore}
        onToggle={(event) => onShowMoreChange((event.target as HTMLDetailsElement).open)}
      >
        <summary title={t({ de: "TOTP, Vorlagen, Einfügen aus der Zwischenablage", en: "TOTP, templates, paste from clipboard" })}>
          {t({ de: "Weitere Optionen", en: "More options" })}
        </summary>
        <p className="hint">
          {t({
            de: "Einfügen erkennt Token, URLs und TOTP. Speichern legt es erst in den Tresor.",
            en: "Paste detects tokens, URLs, and TOTP. Save is what stores it in the vault.",
          })}
        </p>
        <label>
          <FieldLabel
            text={t({ de: "Einfügen", en: "Paste" })}
            tip={t({
              de: "Rohtext zum Erkennen. Wird nicht automatisch gespeichert.",
              en: "Raw text to detect. Not saved automatically.",
            })}
          />
          <textarea
            rows={3}
            value={paste}
            onChange={(event) => onPasteChange(event.target.value)}
            data-testid="detect-paste"
            placeholder="ghp_… · sk-… · ftp.example.com · https://…"
          />
        </label>
        <div className="actions">
          <button
            type="button"
            data-testid="detect-clipboard"
            title={t({
              de: "Liest die Zwischenablage einmal. Es gibt kein laufendes Mithören.",
              en: "Reads the clipboard once. There is no continuous monitoring.",
            })}
            onClick={onDetectClipboard}
          >
            {t({ de: "Zwischenablage einmal lesen", en: "Read clipboard once" })}
          </button>
          <button
            type="button"
            data-testid="detect-apply"
            title={t({ de: "Text oben auswerten und Felder füllen", en: "Parse the text above and fill fields" })}
            onClick={onDetectApply}
          >
            {t({ de: "Erkennen", en: "Detect" })}
          </button>
        </div>
        {detectedLabel ? (
          <p className="ok" data-testid="detect-label">
            {detectedLabel}
          </p>
        ) : null}
        <div className="tabs">
          {BUILTIN_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              data-testid={`template-${template.id}`}
              title={t({ de: `Vorlage ${template.name} anwenden`, en: `Apply ${template.name} template` })}
              onClick={() => onApplyBuiltinTemplate(template.id)}
            >
              {template.name}
            </button>
          ))}
        </div>
        <label>
          <FieldLabel
            text={t({ de: "Eigenes Template", en: "Custom template" })}
            tip={t({
              de: "YAML-ähnliche Vorlage für Anbieter und Rechte. Speichern bleibt nötig.",
              en: "YAML-like template for provider and capabilities. You still have to save.",
            })}
          />
          <textarea
            rows={4}
            value={customTemplate}
            onChange={(event) => onCustomTemplateChange(event.target.value)}
            data-testid="custom-template"
            placeholder={"id: acme\nname: Acme\n  - widget.read"}
          />
        </label>
        <button
          type="button"
          data-testid="apply-custom-template"
          onClick={onApplyCustomTemplate}
        >
          {t({ de: "Template anwenden", en: "Apply custom template" })}
        </button>
        <label>
          <FieldLabel
            text={t({ de: "Anbieter", en: "Provider" })}
            tip={t({ de: "z. B. GitHub. Kein Vertrauensbeweis.", en: "e.g. GitHub. Not a trust signal." })}
          />
          <input
            value={draft.provider}
            onChange={(event) => onChange({ ...draft, provider: event.target.value })}
            data-testid="entry-provider"
            placeholder="GitHub"
          />
        </label>
        <label>
          <FieldLabel
            text={t({ de: "Konto", en: "Account" })}
            tip={t({ de: "Welches Konto bei diesem Anbieter, z. B. personal oder work.", en: "Which account at this provider, e.g. personal or work." })}
          />
          <input
            value={draft.account}
            onChange={(event) => onChange({ ...draft, account: event.target.value })}
            data-testid="entry-account"
            placeholder={t({ de: "personal", en: "personal" })}
          />
        </label>
        {draft.kind === "api" ? (
          <label>
            <FieldLabel
              text={t({ de: "Rechte", en: "Capabilities" })}
              tip={t({
                de: "Was ein Programm mit Erlauben tun darf. Kein Passwort.",
                en: "What a program may do after Allow. Not a password.",
              })}
            />
            <input
              value={draft.capabilities}
              onChange={(event) => onChange({ ...draft, capabilities: event.target.value })}
              data-testid="entry-capabilities"
              placeholder="repository.read"
            />
          </label>
        ) : null}
        <label>
          <FieldLabel
            text={t({ de: "TOTP-Geheimnis (Base32 / otpauth)", en: "TOTP secret (Base32 / otpauth)" })}
            tip={t({
              de: "otpauth:// oder Base32. Der Code wird nur auf diesem Gerät erzeugt.",
              en: "otpauth:// or Base32. The code is generated only on this device.",
            })}
          />
          <input
            type="password"
            value={draft.totpSecret}
            onChange={(event) => onChange(applyTotpInput(draft, event.target.value))}
            data-testid="entry-totp"
            autoComplete="off"
            placeholder="JBSWY… or otpauth://totp/…"
          />
        </label>
        {draft.totpSecret.startsWith("otpauth:") ? (
          <p className="hint">
            {t({
              de: "Hier einfügen, dann speichern.",
              en: "Paste into the box, then save.",
            })}
          </p>
        ) : draft.totpSecret ? (
          <TotpCode secret={draft.totpSecret} />
        ) : null}
      </details>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void onSave()}
          disabled={busy}
          data-testid="save-entry"
          title={t({
            de: "Verschlüsselt den Eintrag und schreibt den Tresor-Stand.",
            en: "Encrypts the entry and writes the vault revision.",
          })}
        >
          {busy
            ? t({ de: "Wird gespeichert…", en: "Saving…" })
            : t({ de: "Speichern", en: "Save" })}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {t({ de: "Abbrechen", en: "Cancel" })}
        </button>
        {selected ? (
          <>
            <button
              type="button"
              data-testid="share-entry"
              onClick={onShare}
              disabled={busy}
              title={t({
                de: "Erzeugt eine Datei plus Share-Schlüssel. Beides bleibt lokal.",
                en: "Builds a file plus a share key. Both stay local.",
              })}
            >
              {t({ de: "Teilen", en: "Share" })}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void onRemove()}
              disabled={busy}
              title={t({
                de: "Löscht diesen Eintrag aus dem Tresor.",
                en: "Deletes this entry from the vault.",
              })}
            >
              {t({ de: "Löschen", en: "Delete" })}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

function kindTip(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "Token oder API-Key für Programme", en: "Token or API key for programs" });
  if (kind === "sftp") return t({ de: "SSH, SFTP oder FTP-Zugang", en: "SSH, SFTP, or FTP login" });
  return t({ de: "Website-Login mit Benutzername und Passwort", en: "Website login with username and password" });
}

function titlePlaceholder(kind: EntryKind, t: Translate): string {
  if (kind === "api") return t({ de: "z. B. GitHub PAT", en: "e.g. GitHub PAT" });
  if (kind === "sftp") return t({ de: "z. B. Backup-Server", en: "e.g. backup server" });
  return t({ de: "z. B. GitHub", en: "e.g. GitHub" });
}
