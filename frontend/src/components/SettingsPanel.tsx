import { useEffect, useState, type ReactNode } from "react";
import { isTauriShell } from "../lib/webauthnCapabilities.ts";
import { launchAtLoginEnabled, setLaunchAtLogin } from "../lib/desktop.ts";
import {
  LAUNCH_AT_LOGIN_BROWSER,
  LAUNCH_AT_LOGIN_HINT,
  LAUNCH_AT_LOGIN_LABEL,
  SLEEP_LOCK_HINT,
  UNINSTALL_HINT,
} from "../lib/desktop-settings.ts";
import { useCopy } from "../state/copy-mode.tsx";
import { useApp } from "../state/app-state.tsx";
import { readStorageOrigin, writeStorageOrigin } from "../lib/storage-origin.ts";

export function SettingsPanel(): ReactNode {
  const desktop = isTauriShell();
  const { signOut } = useApp();
  const { plain, setPlain, t } = useCopy();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [originDraft, setOriginDraft] = useState(() => readStorageOrigin() ?? "");
  const [originError, setOriginError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void launchAtLoginEnabled().then((value) => {
      if (typeof value === "boolean") setEnabled(value);
    });
  }, [desktop]);

  async function toggle(): Promise<void> {
    if (!desktop || busy) return;
    setBusy(true);
    const next = !enabled;
    const ok = await setLaunchAtLogin(next);
    if (ok) setEnabled(next);
    setBusy(false);
  }

  return (
    <section className="card" data-testid="settings-desktop">
      <h3>{t({ de: "Wie ist mein Tresor geschützt?", en: "How is my vault protected?" })}</h3>
      <p className="muted">
        {t({
          de: "Verschlüsselt auf diesem Gerät. Nur du öffnest ihn. Sperren und Ruhemodus, nicht die Bildschirmsperre.",
          en: "Encrypted on this device. Only you open it. Lock and sleep, not the screen lock.",
        })}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={plain}
          data-testid="plain-language"
          onChange={(event) => setPlain(event.target.checked)}
        />
        {t({ de: "Leichte Sprache (Standard)", en: "Plain language (default)" })}
      </label>
      <p className="hint" data-testid="plain-language-hint">
        {t(
          {
            de: "An: kurze Sätze, DE und EN. Aus: mehr Fachwörter, für Kenner.",
            en: "On: short sentences, DE and EN. Off: more jargon, for experts.",
          },
        )}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!desktop || busy}
          data-testid="launch-at-login"
          onChange={() => void toggle()}
        />
        {LAUNCH_AT_LOGIN_LABEL}
      </label>
      <p className="hint" data-testid="launch-at-login-hint">
        {desktop ? LAUNCH_AT_LOGIN_HINT : LAUNCH_AT_LOGIN_BROWSER}
      </p>
      <p className="hint" data-testid="sleep-lock-hint">
        {SLEEP_LOCK_HINT}
      </p>
      <p className="hint" data-testid="uninstall-hint">
        {UNINSTALL_HINT}
      </p>
      <form
        className="stack-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setOriginError(null);
          try {
            const origin = writeStorageOrigin(originDraft.trim() || null);
            void origin;
            void signOut().finally(() => {
              window.location.reload();
            });
          } catch (error) {
            setOriginError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <label>
          {t({ de: "Eigener Server (nur Chiffretext)", en: "Your server (ciphertext only)" })}
          <input
            type="url"
            autoComplete="off"
            placeholder="https://vault.4allpass.netzwerkpunkt.de"
            value={originDraft}
            onChange={(event) => setOriginDraft(event.target.value)}
            data-testid="storage-origin"
          />
        </label>
        <p className="hint" data-testid="storage-origin-hint">
          {t({
            de: "Leer = dieser Ursprung. Die Produktseite 4allpass.netzwerkpunkt.de ist kein Tresor.",
            en: "Blank = this origin. The product page 4allpass.netzwerkpunkt.de is not a vault.",
          })}
        </p>
        {originError ? <p className="error-text">{originError}</p> : null}
        <button type="submit" data-testid="storage-origin-save">
          {t({ de: "Server merken", en: "Save server" })}
        </button>
      </form>
    </section>
  );
}
